import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectWorkspaceReadiness } from '../scripts/workspace-readiness.mjs';

const temporaryDirectories: string[] = [];
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'umrah-readiness-'));
  temporaryDirectories.push(dir);
  const dbPath = path.join(dir, 'fixture.db');
  const db = new Database(dbPath);
  // Legacy columns used by the report; intentionally allow dangling records,
  // because the running app has not enabled foreign-key enforcement.
  db.exec(`
    CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT,
      company_name TEXT, role TEXT, is_active INTEGER, company_id INTEGER);
    CREATE TABLE logistics_rows (id TEXT PRIMARY KEY, user_id INTEGER, data TEXT, deleted_at TEXT);
    CREATE TABLE settings (user_id INTEGER PRIMARY KEY, tg_config TEXT, templates TEXT,
      deleted_rows TEXT, notified_ids TEXT, font_size INTEGER, extra_settings TEXT);
    CREATE TABLE trip_row_access (row_id TEXT, user_id INTEGER, granted_by_user_id INTEGER, role TEXT);
    CREATE TABLE trip_group_access (group_no TEXT, user_id INTEGER, granted_by_user_id INTEGER, role TEXT);
    CREATE TABLE trip_agency_access (agency TEXT, user_id INTEGER, granted_by_user_id INTEGER, role TEXT);
    CREATE TABLE trip_share_invitations (id INTEGER PRIMARY KEY, sender_user_id INTEGER,
      receiver_user_id INTEGER, scope_type TEXT, row_id TEXT, group_no TEXT, agency TEXT, role TEXT, status TEXT);
    INSERT INTO companies VALUES (10, 'Secret Company A'), (20, 'Secret Company B');
    INSERT INTO users VALUES
      (1, 'private-login', 'private-password-hash', 'Same profile label', 'user', 1, 10),
      (2, 'private-other-login', 'other-password-hash', 'Same profile label', 'user', 0, 20),
      (3, 'unassigned', 'hash', 'Same profile label', 'user', 1, NULL),
      (4, 'platform-admin', 'admin-hash', NULL, 'admin', 1, 10),
      (5, 'bad-company', 'hash', NULL, 'user', 1, 999);
  `);
  const addRow = db.prepare('INSERT INTO logistics_rows VALUES (?, ?, ?, ?)');
  addRow.run('row-a', 1, JSON.stringify({ groupNo: '100', agency: 'Private Agency', groupName: 'Private pilgrims' }), null);
  addRow.run('row-b', 2, JSON.stringify({ groupNo: '100', agency: 'Private Agency' }), '2026-01-01');
  addRow.run('row-orphan', 999, '{}', null);
  addRow.run('row-admin', 4, '{}', null);
  db.close();
  return { dbPath, open: () => new Database(dbPath) };
};

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('workspace migration readiness', () => {
  it('reports candidate IDs and separate deleted trip counts without approving ownership', () => {
    const { dbPath } = fixture();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.accounts.find(a => a.userId === 1)).toMatchObject({ candidateWorkspaceId: 10, activeTripCount: 1, deletedTripCount: 0, reviewRequired: true });
    expect(report.accounts.find(a => a.userId === 2)).toMatchObject({ candidateWorkspaceId: 20, active: false, activeTripCount: 0, deletedTripCount: 1 });
    expect(report.accounts.find(a => a.userId === 3)?.candidateWorkspaceId).toBeNull();
    expect(report.accounts.find(a => a.userId === 5)?.candidateWorkspaceId).toBeNull();
    expect(report.platformAdminUserIds).toEqual([4]);
    expect(report.workspaces).toEqual([
      { workspaceId: 10, candidateMemberUserIds: [1], ownerUserId: null, reviewRequired: true },
      { workspaceId: 20, candidateMemberUserIds: [2], ownerUserId: null, reviewRequired: true },
    ]);
    expect(report.orphanTripCount).toBe(1);
    expect(report.platformAdminTripCount).toBe(1);
    expect(report.totals).toMatchObject({ trips: 4, activeTrips: 3, deletedTrips: 1 });
    expect(report.readyForMigration).toBe(false);
  });

  it('flags global scope collisions without attributing a source to the grantor', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`INSERT INTO trip_group_access VALUES ('100', 3, 1, 'editor');
      INSERT INTO trip_agency_access VALUES ('Private Agency', 2, 1, 'viewer');`);
    db.close();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.shares).toHaveLength(2);
    for (const share of report.shares) {
      expect(share).toMatchObject({ candidateSourceWorkspaceIds: [10, 20], sourceWorkspaceId: null, reviewRequired: true });
      expect(share.issues).toContain('GLOBAL_SCOPE_REQUIRES_REAUTHORIZATION');
    }
  });

  it.each([
    { group: ['100'], agency: {}, grantGroup: '100', grantAgency: '[object Object]' },
    { group: true, agency: ['Private Agency'], grantGroup: 'true', grantAgency: 'Private Agency' },
  ])('matches JavaScript scope coercion for legacy JSON field types: $group', ({ group, agency, grantGroup, grantAgency }) => {
    const { dbPath, open } = fixture();
    const db = open();
    db.prepare('UPDATE logistics_rows SET data = ? WHERE id = ?').run(JSON.stringify({ groupNo: group, agency }), 'row-a');
    db.prepare('UPDATE logistics_rows SET data = ? WHERE id = ?').run(JSON.stringify({ groupNo: grantGroup, agency: grantAgency }), 'row-b');
    db.prepare('INSERT INTO trip_group_access VALUES (?, 3, 1, ?)').run(grantGroup, 'editor');
    db.prepare('INSERT INTO trip_agency_access VALUES (?, 3, 1, ?)').run(grantAgency, 'editor');
    db.close();
    for (const share of inspectWorkspaceReadiness({ dbPath }).shares) {
      expect(share.candidateSourceWorkspaceIds).toEqual([10, 20]);
      expect(share.issues).toContain('MULTIPLE_SOURCE_WORKSPACES');
    }
  });

  it('keeps row ownership distinct from a resharing grantor and detects missing rows/accounts', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`INSERT INTO trip_row_access VALUES ('row-a', 3, 2, 'viewer');
      INSERT INTO trip_row_access VALUES ('missing-row', 999, 999, 'editor');
      INSERT INTO trip_share_invitations VALUES (1, 2, 3, 'row', 'row-a', NULL, NULL, 'editor', 'pending');`);
    db.close();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.shares[0]).toMatchObject({ candidateSourceWorkspaceIds: [10], sourceWorkspaceId: null, grantorUserId: 2 });
    expect(report.shares[1].issues).toEqual(expect.arrayContaining(['MISSING_ROW', 'MISSING_RECIPIENT', 'MISSING_GRANTOR']));
    expect(report.invitations[0]).toMatchObject({ invitationId: 1, candidateSourceWorkspaceIds: [10], reviewRequired: true });
  });

  it('reports malformed trip JSON, orphan settings and legacy trash without exposing their content', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`INSERT INTO logistics_rows VALUES ('broken', 1, 'malformed-private-data', NULL);
      INSERT INTO settings VALUES (1, '{"token":"private-bot-token"}', '["private-template"]', '[{"name":"private-trash"}]', '["private-notified"]', 110, '{"alertSettings":{}}');
      INSERT INTO settings VALUES (999, NULL, NULL, 'broken-private-trash', NULL, 100, NULL);`);
    db.close();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.invalidTripJsonCount).toBe(1);
    expect(report.settings.find(s => s.userId === 1)).toMatchObject({ hasTelegramConfig: true, hasTemplates: true, legacyDeletedRowCount: 1, hasAlertSettings: true });
    expect(report.settings.find(s => s.userId === 999)?.issues).toEqual(expect.arrayContaining(['MISSING_ACCOUNT', 'INVALID_LEGACY_TRASH']));
    const serialized = JSON.stringify(report);
    for (const privateValue of ['private-bot-token', 'private-template', 'private-trash', 'private-notified', 'malformed-private-data']) expect(serialized).not.toContain(privateValue);
  });

  it('marks multiple configured integrations for review without decrypting or selecting one', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`UPDATE users SET company_id = 10 WHERE id = 2;
      INSERT INTO settings (user_id, tg_config) VALUES (1, 'enc:v1:secret-1'), (2, 'enc:v1:secret-2');`);
    db.close();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.integrationReviews).toEqual([{ workspaceId: 10, configuredUserIds: [1, 2], reviewRequired: true }]);
  });

  it('never serializes login/profile names, company labels, passwords, or share scope values', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`INSERT INTO trip_agency_access VALUES ('Private Agency', 2, 1, 'editor');`);
    db.close();
    const serialized = JSON.stringify(inspectWorkspaceReadiness({ dbPath }));
    for (const value of ['private-login', 'private-password-hash', 'Same profile label', 'Secret Company', 'Private Agency', 'Private pilgrims']) expect(serialized).not.toContain(value);
  });

  it('redacts corrupt invitation scope/status values rather than echoing stored text', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`INSERT INTO trip_share_invitations VALUES (1, 1, 2, 'private-invalid-scope', NULL, NULL, NULL, 'viewer', 'private-invalid-status');`);
    db.close();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.invitations[0]).toMatchObject({ scope: 'unknown', status: 'unknown', issues: expect.arrayContaining(['INVALID_SCOPE']) });
    expect(JSON.stringify(report)).not.toContain('private-invalid');
  });

  it('redacts corrupt INTEGER-affinity foreign IDs and flags them for review', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec(`UPDATE users SET company_id = 'private-corrupt-company-id' WHERE id = 1;
      INSERT INTO trip_row_access VALUES ('row-a', 'private-corrupt-recipient', 'private-corrupt-grantor', 'viewer');
      INSERT INTO trip_share_invitations VALUES (1, 'private-corrupt-sender', 'private-corrupt-receiver', 'row', 'row-a', NULL, NULL, 'editor', 'pending');`);
    db.close();
    const report = inspectWorkspaceReadiness({ dbPath });
    expect(report.accounts.find(a => a.userId === 1)).toMatchObject({ existingCompanyId: null, candidateWorkspaceId: null, issues: expect.arrayContaining(['INVALID_COMPANY_ID']) });
    expect(report.shares[0]).toMatchObject({ recipientUserId: null, grantorUserId: null, issues: expect.arrayContaining(['INVALID_RECIPIENT_ID', 'INVALID_GRANTOR_ID']) });
    expect(report.invitations[0]).toMatchObject({ recipientUserId: null, grantorUserId: null });
    expect(JSON.stringify(report)).not.toContain('private-corrupt');
  });

  it('does not alter database bytes or create a missing database', () => {
    const { dbPath } = fixture();
    const before = readFileSync(dbPath);
    inspectWorkspaceReadiness({ dbPath });
    expect(readFileSync(dbPath)).toEqual(before);
    const missing = path.join(path.dirname(dbPath), 'missing.db');
    expect(() => inspectWorkspaceReadiness({ dbPath: missing })).toThrow();
    expect(existsSync(missing)).toBe(false);
  });

  it('refuses a migrated/unknown schema rather than returning misleading legacy mappings', () => {
    const { dbPath, open } = fixture();
    const db = open();
    db.exec('ALTER TABLE logistics_rows ADD COLUMN workspace_id INTEGER');
    db.close();
    expect(() => inspectWorkspaceReadiness({ dbPath })).toThrow('legacy');
  });

  it('runs as a CLI with an explicit existing database and rejects unknown options', () => {
    const { dbPath } = fixture();
    const script = path.resolve('scripts/workspace-readiness.mjs');
    const result = spawnSync(process.execPath, [script, '--db', dbPath], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).totals.trips).toBe(4);
    const noArgs = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(noArgs.status).toBe(1);
    const unknown = spawnSync(process.execPath, [script, '--db', dbPath, '--apply'], { encoding: 'utf8' });
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toBe('');
  });
});
