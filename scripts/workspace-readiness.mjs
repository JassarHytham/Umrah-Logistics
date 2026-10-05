import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const safeId = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

// json_extract returns SQLite scalars, losing JS booleans and compound types.
// Reconstruct just the scope field before mirroring the server's String rules.
const scopeString = (value, type, trim = false) => {
  const original = type === 'true' ? true : type === 'false' ? false
    : type === 'array' || type === 'object' ? JSON.parse(value) : value;
  if (!original) return '';
  return trim ? String(original).trim() : String(original);
};

// Standalone by design: importing server.ts would run bootstrap/migrations/jobs.
// Only allowlisted IDs, counts and booleans leave this module. Never decrypt
// integration settings or serialize raw trip JSON, login names or scope values.
export function inspectWorkspaceReadiness({ dbPath }) {
  if (!dbPath || typeof dbPath !== 'string') throw new Error('An explicit database path is required');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    return db.transaction(() => inspectLegacyDatabase(db)).deferred();
  } finally {
    db.close();
  }
}

function inspectLegacyDatabase(db) {
  const requiredColumns = {
    users: ['id', 'company_id', 'role', 'is_active'],
    companies: ['id'],
    logistics_rows: ['id', 'user_id', 'data', 'deleted_at'],
    settings: ['user_id', 'tg_config', 'templates', 'deleted_rows', 'extra_settings'],
    trip_row_access: ['row_id', 'user_id', 'granted_by_user_id', 'role'],
    trip_group_access: ['group_no', 'user_id', 'granted_by_user_id', 'role'],
    trip_agency_access: ['agency', 'user_id', 'granted_by_user_id', 'role'],
    trip_share_invitations: ['id', 'sender_user_id', 'receiver_user_id', 'scope_type', 'row_id', 'group_no', 'agency', 'role', 'status'],
  };
  for (const [table, required] of Object.entries(requiredColumns)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (required.some(column => !columns.includes(column)) || columns.includes('workspace_id')) {
      throw new Error(`Unsupported legacy schema: ${table}`);
    }
  }

  const users = db.prepare('SELECT id, company_id, role, is_active FROM users ORDER BY id').all();
  const companies = db.prepare('SELECT id FROM companies ORDER BY id').all();
  if (users.some(u => safeId(u.id) === null) || companies.some(c => safeId(c.id) === null)) {
    throw new Error('Unsupported legacy identifiers');
  }
  const companyIds = new Set(companies.map(c => c.id));
  const userById = new Map(users.map(u => [u.id, u]));
  const candidateWorkspace = userId => {
    const user = userById.get(userId);
    return user?.role === 'user' && companyIds.has(user.company_id) ? user.company_id : null;
  };
  const countByUser = new Map(db.prepare(`
    SELECT user_id,
      SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted
    FROM logistics_rows GROUP BY user_id
  `).all().map(r => [r.user_id, r]));
  const customerUsers = users.filter(u => u.role !== 'admin');
  const accounts = customerUsers.map(user => ({
    userId: user.id,
    active: user.is_active === 1,
    existingCompanyId: safeId(user.company_id),
    candidateWorkspaceId: candidateWorkspace(user.id),
    activeTripCount: countByUser.get(user.id)?.active ?? 0,
    deletedTripCount: countByUser.get(user.id)?.deleted ?? 0,
    reviewRequired: true,
    issues: [
      ...(user.company_id == null ? ['NO_COMPANY_ASSIGNMENT'] : safeId(user.company_id) === null ? ['INVALID_COMPANY_ID'] : !companyIds.has(user.company_id) ? ['MISSING_COMPANY'] : []),
      ...(user.role !== 'user' ? ['UNKNOWN_ACCOUNT_ROLE'] : []),
    ],
  }));

  // Extract only the fields needed to detect GLOBAL collisions. Malformed JSON
  // is counted separately and never repaired or silently discarded.
  const rows = db.prepare(`
    SELECT id, user_id,
      CASE WHEN json_valid(data) THEN json_extract(data, '$.groupNo') END AS group_no,
      CASE WHEN json_valid(data) THEN json_type(data, '$.groupNo') END AS group_type,
      CASE WHEN json_valid(data) THEN json_extract(data, '$.agency') END AS agency,
      CASE WHEN json_valid(data) THEN json_type(data, '$.agency') END AS agency_type
    FROM logistics_rows ORDER BY id
  `).all();
  const rowById = new Map(rows.map(r => [r.id, r]));
  const scopeOwners = { group: new Map(), agency: new Map() };
  for (const row of rows) {
    for (const [scope, value, type] of [['group', row.group_no, row.group_type], ['agency', row.agency, row.agency_type]]) {
      // Match the existing access functions: groups use String with no trim;
      // agencies use String(...).trim(). Do not normalize into broader matches.
      const key = scopeString(value, type, scope === 'agency');
      if (!key) continue;
      const owners = scopeOwners[scope].get(key) ?? new Set();
      owners.add(row.user_id);
      scopeOwners[scope].set(key, owners);
    }
  }

  function shareReview(scope, value, recipientId, grantorId, reviewRef, role) {
    const issues = [];
    if (safeId(recipientId) === null) issues.push('INVALID_RECIPIENT_ID');
    if (safeId(grantorId) === null) issues.push('INVALID_GRANTOR_ID');
    const recipient = userById.get(recipientId);
    const grantor = userById.get(grantorId);
    if (!recipient) issues.push('MISSING_RECIPIENT');
    else {
      if (!recipient.is_active) issues.push('INACTIVE_RECIPIENT');
      if (!candidateWorkspace(recipientId)) issues.push('UNMAPPED_RECIPIENT');
    }
    if (!grantor) issues.push('MISSING_GRANTOR');
    else if (!grantor.is_active) issues.push('INACTIVE_GRANTOR');
    if (!['viewer', 'editor'].includes(role)) issues.push('INVALID_SHARE_ROLE');
    let ownerIds = [];
    if (scope === 'row') {
      const row = rowById.get(value);
      if (!row) issues.push('MISSING_ROW');
      else ownerIds = [row.user_id];
    } else if (scope === 'group' || scope === 'agency') {
      issues.push('GLOBAL_SCOPE_REQUIRES_REAUTHORIZATION');
      const key = scope === 'agency' ? String(value || '').trim() : String(value || '');
      ownerIds = Array.from(scopeOwners[scope].get(key) ?? []);
      if (ownerIds.length === 0) issues.push('NO_MATCHING_ROWS');
    } else issues.push('INVALID_SCOPE');
    if (ownerIds.some(id => candidateWorkspace(id) === null)) issues.push('UNMAPPED_SOURCE_OWNER');
    const candidateSourceWorkspaceIds = [...new Set(ownerIds.map(candidateWorkspace).filter(id => id !== null))].sort((a, b) => a - b);
    if (candidateSourceWorkspaceIds.length > 1) issues.push('MULTIPLE_SOURCE_WORKSPACES');
    return {
      reviewRef, scope: ['row', 'group', 'agency'].includes(scope) ? scope : 'unknown',
      recipientUserId: safeId(recipientId), grantorUserId: safeId(grantorId),
      sourceWorkspaceId: null, candidateSourceWorkspaceIds, reviewRequired: true, issues,
    };
  }

  const shares = [];
  for (const [scope, table, column] of [
    ['row', 'trip_row_access', 'row_id'],
    ['group', 'trip_group_access', 'group_no'],
    ['agency', 'trip_agency_access', 'agency'],
  ]) {
    const grants = db.prepare(`SELECT rowid AS review_id, ${column} AS scope_value, user_id, granted_by_user_id, role FROM ${table} ORDER BY rowid`).all();
    for (const grant of grants) {
      if (safeId(grant.review_id) === null) throw new Error('Unsupported legacy identifiers');
      shares.push(shareReview(scope, grant.scope_value, grant.user_id, grant.granted_by_user_id, `${table}:${grant.review_id}`, grant.role));
    }
  }
  const invitations = db.prepare(`
    SELECT id, scope_type, row_id, group_no, agency, receiver_user_id, sender_user_id, role, status
    FROM trip_share_invitations ORDER BY id
  `).all().map(invitation => {
    if (safeId(invitation.id) === null) throw new Error('Unsupported legacy identifiers');
    return {
      ...shareReview(invitation.scope_type,
        invitation.scope_type === 'row' ? invitation.row_id : invitation.scope_type === 'group' ? invitation.group_no : invitation.agency,
        invitation.receiver_user_id, invitation.sender_user_id, `trip_share_invitations:${invitation.id}`, invitation.role),
      invitationId: invitation.id,
      // Stored text may be corrupt/private; only serialize known status values.
      status: ['pending', 'accepted', 'declined'].includes(invitation.status) ? invitation.status : 'unknown',
    };
  });

  const settings = db.prepare(`
    SELECT user_id,
      CASE WHEN tg_config IS NOT NULL AND tg_config != '' AND tg_config != 'null' THEN 1 ELSE 0 END AS has_telegram,
      CASE WHEN templates IS NOT NULL AND templates NOT IN ('', 'null', '[]') THEN 1 ELSE 0 END AS has_templates,
      CASE WHEN json_valid(extra_settings) THEN json_type(extra_settings, '$.alertSettings') IS NOT NULL ELSE 0 END AS has_alerts,
      CASE WHEN deleted_rows IS NULL OR deleted_rows = '' THEN 0
        WHEN json_valid(deleted_rows) THEN
          CASE WHEN json_type(deleted_rows) = 'array' THEN json_array_length(deleted_rows) ELSE NULL END
        ELSE NULL END AS legacy_deleted_count
    FROM settings ORDER BY user_id
  `).all().map(s => ({
    userId: safeId(s.user_id), hasTelegramConfig: Boolean(s.has_telegram), hasTemplates: Boolean(s.has_templates),
    hasAlertSettings: Boolean(s.has_alerts), legacyDeletedRowCount: s.legacy_deleted_count,
    issues: [...(safeId(s.user_id) === null ? ['INVALID_ACCOUNT_ID'] : []), ...(!userById.has(s.user_id) ? ['MISSING_ACCOUNT'] : []), ...(s.legacy_deleted_count === null ? ['INVALID_LEGACY_TRASH'] : [])],
  }));
  const workspaces = companies.map(company => ({
    workspaceId: company.id,
    candidateMemberUserIds: accounts.filter(a => a.candidateWorkspaceId === company.id).map(a => a.userId),
    ownerUserId: null, reviewRequired: true,
  }));
  const integrationReviews = workspaces.map(workspace => ({
    workspaceId: workspace.workspaceId,
    configuredUserIds: settings.filter(s => workspace.candidateMemberUserIds.includes(s.userId) && (s.hasTelegramConfig || s.hasTemplates || s.hasAlertSettings)).map(s => s.userId),
    reviewRequired: true,
  })).filter(r => r.configuredUserIds.length > 1);
  const tripCounts = db.prepare(`SELECT COUNT(*) AS trips,
    COALESCE(SUM(deleted_at IS NULL), 0) AS activeTrips,
    COALESCE(SUM(deleted_at IS NOT NULL), 0) AS deletedTrips FROM logistics_rows`).get();
  return {
    reportVersion: 1, generatedAt: new Date().toISOString(), readyForMigration: false,
    totals: { accounts: users.length, customerAccounts: customerUsers.length, companies: companies.length, ...tripCounts },
    accounts, platformAdminUserIds: users.filter(u => u.role === 'admin').map(u => u.id), workspaces,
    orphanTripCount: rows.filter(r => !userById.has(r.user_id)).length,
    platformAdminTripCount: rows.filter(r => userById.get(r.user_id)?.role === 'admin').length,
    invalidTripJsonCount: db.prepare('SELECT COUNT(*) AS count FROM logistics_rows WHERE NOT json_valid(data)').get().count,
    shares, invitations, settings, integrationReviews,
  };
}

function runCli(argv) {
  if (argv.length !== 2 || argv[0] !== '--db' || !argv[1] || argv[1].startsWith('--')) {
    throw new Error('Usage: node scripts/workspace-readiness.mjs --db /path/to/existing.db');
  }
  process.stdout.write(`${JSON.stringify(inspectWorkspaceReadiness({ dbPath: argv[1] }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runCli(process.argv.slice(2)); }
  catch (error) {
    // Avoid printing SQLite errors that might contain stored values.
    const message = error instanceof Error && /^(Usage:|Unsupported legacy schema:)/.test(error.message)
      ? error.message : 'Readiness inspection failed. Check database existence, permissions and legacy schema.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
