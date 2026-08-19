/**
 * Regression tests for the cross-surface consistency bugs reported in production:
 *
 *   1. "cannot delete"          — deleting a row the browser still shows but the
 *                                 server already removed/soft-deleted returned 404.
 *   2. "issue with the syncing" — /api/ingest/text rewrote every row the user owned
 *                                 without carrying `version` forward, so every open
 *                                 tab instantly held a stale `_version` and its next
 *                                 sync/patch came back 409.
 *   3. "overwrite duplicates"   — overwrite hard-deleted the old group rows, then the
 *                                 open tab's debounced full-set sync re-INSERTed them,
 *                                 so the user ended up with old + new copies.
 *
 * Each block below pins one of those root causes.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const registerUser = async (prefix: string) => {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 8) || 'user';
  const suffix = Math.random().toString(36).slice(2, 10);
  const credentials = { username: `${safePrefix}_${suffix}`, password: 'Password123!' };
  const res = await request(app).post('/api/auth/register').send(credentials);
  return { ...credentials, token: res.body.token, user: res.body.user };
};

const makeRow = (id: string, groupNo: unknown = 'S001') => ({
  id,
  groupNo,
  groupName: 'Consistency Group',
  agency: 'Consistency Agency',
  count: '4',
  Column1: 'وصول',
  date: '15/01/2026',
  time: '14:30',
  flight: 'SV123',
  from: 'جدة',
  to: 'مكة المكرمة',
  carType: 'سيدان',
  tafweej: 'Test',
  status: 'Planned',
});

const INGEST_TEXT = `
رحلة الوصول
تاريخ الوصول
15/01/2026
وقت الوصول
14:30
رقم الرحلة
SV123
المطار
مطار الملك عبد العزيز

رحلة المغادرة
تاريخ المغادرة
20/01/2026
وقت المغادرة
10:00
رقم الرحلة
SV456
المطار
مطار الأمير محمد
`;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const sync = (token: string, rows: any[]) =>
  request(app).post('/api/data/sync').set(auth(token)).send({ rows });

const fetchRows = (token: string) =>
  request(app).get('/api/data').set(auth(token));

const fetchDeleted = (token: string) =>
  request(app).get('/api/data/deleted').set(auth(token));

const ingest = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/ingest/text').set(auth(token)).send({
    text: INGEST_TEXT,
    groupName: 'Ingested Group',
    count: '4',
    ...body,
  });

// ─────────────────────────────────────────────
// Root cause: ingest reset `version` on every row the user owned
// ─────────────────────────────────────────────
describe('POST /api/ingest/text version stability', () => {
  it('leaves the version of rows outside the ingested group untouched', async () => {
    const user = await registerUser('ver_keep');
    const untouched = makeRow(`ver-keep-${Date.now()}`, 'GRP-KEEP');
    await sync(user.token, [untouched]);

    // Bump the row's version a couple of times, the way ordinary cell edits do.
    for (const status of ['Confirmed', 'In Progress']) {
      const res = await request(app)
        .patch(`/api/data/${untouched.id}`)
        .set(auth(user.token))
        .send({ updates: { status } });
      expect(res.status).toBe(200);
    }

    const before = (await fetchRows(user.token)).body.find((r: any) => r.id === untouched.id);
    expect(before._version).toBe(3);

    const res = await ingest(user.token, { groupNo: 'GRP-OTHER' });
    expect(res.status).toBe(200);

    const after = (await fetchRows(user.token)).body.find((r: any) => r.id === untouched.id);
    // Regression: the old delete-all/re-insert-all pass dropped `version`, so this
    // came back as 1 and every open tab's next PATCH/sync 409'd.
    expect(after._version).toBe(3);
    expect(after.status).toBe('In Progress');
  });

  it('does not 409 a tab that patches an unrelated row right after a capture', async () => {
    const user = await registerUser('ver_patch');
    const other = makeRow(`ver-patch-${Date.now()}`, 'GRP-PATCH');
    await sync(user.token, [other]);

    const seen = (await fetchRows(user.token)).body.find((r: any) => r.id === other.id);

    await ingest(user.token, { groupNo: 'GRP-CAPTURED' });

    // The tab still holds the version it last saw; that must remain valid.
    const res = await request(app)
      .patch(`/api/data/${other.id}`)
      .set(auth(user.token))
      .send({ updates: { status: 'Confirmed' }, baseVersion: seen._version });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────
// Root cause: overwrite hard-deleted rows a stale tab then re-inserted
// ─────────────────────────────────────────────
describe('POST /api/ingest/text overwrite', () => {
  it('removes the previous rows of the group it overwrites', async () => {
    const user = await registerUser('ovw_basic');
    const groupNo = 'OVW-1';
    const stale = [makeRow(`ovw-a-${Date.now()}`, groupNo), makeRow(`ovw-b-${Date.now()}`, groupNo)];
    await sync(user.token, stale);

    const res = await ingest(user.token, { groupNo, overwrite: true });
    expect(res.status).toBe(200);

    const active = (await fetchRows(user.token)).body;
    const activeIds = active.map((r: any) => r.id);
    expect(activeIds).not.toContain(stale[0].id);
    expect(activeIds).not.toContain(stale[1].id);
    expect(active).toHaveLength(res.body.rows.length);
  });

  it('matches the group even when the stored groupNo is a number, not a string', async () => {
    const user = await registerUser('ovw_num');
    // Rows created outside the extension (manual entry, spreadsheet import) can hold
    // a numeric groupNo. The old `r.groupNo !== groupNoValue` strict compare never
    // matched those, so overwrite silently kept them and the user saw duplicates.
    const stale = makeRow(`ovw-num-${Date.now()}`, 4242);
    await sync(user.token, [stale]);

    const res = await ingest(user.token, { groupNo: '4242', overwrite: true });
    expect(res.status).toBe(200);

    const activeIds = (await fetchRows(user.token)).body.map((r: any) => r.id);
    expect(activeIds).not.toContain(stale.id);
  });

  it('matches the group even when the stored groupNo has surrounding whitespace', async () => {
    const user = await registerUser('ovw_ws');
    const stale = makeRow(`ovw-ws-${Date.now()}`, '  7788 ');
    await sync(user.token, [stale]);

    const res = await ingest(user.token, { groupNo: '7788', overwrite: true });
    expect(res.status).toBe(200);

    const activeIds = (await fetchRows(user.token)).body.map((r: any) => r.id);
    expect(activeIds).not.toContain(stale.id);
  });

  it('sends the overwritten rows to the recycle bin instead of destroying them', async () => {
    const user = await registerUser('ovw_bin');
    const groupNo = 'OVW-BIN';
    const stale = makeRow(`ovw-bin-${Date.now()}`, groupNo);
    await sync(user.token, [stale]);

    await ingest(user.token, { groupNo, overwrite: true });

    const deletedIds = (await fetchDeleted(user.token)).body.map((r: any) => r.id);
    expect(deletedIds).toContain(stale.id);
  });

  it('is not undone by a stale tab replaying its pre-overwrite row set', async () => {
    const user = await registerUser('ovw_race');
    const groupNo = 'OVW-RACE';
    const stale = [makeRow(`race-a-${Date.now()}`, groupNo), makeRow(`race-b-${Date.now()}`, groupNo)];
    await sync(user.token, stale);

    // What an open tab is holding at the moment the extension captures.
    const tabRows = (await fetchRows(user.token)).body;

    const res = await ingest(user.token, { groupNo, overwrite: true });
    expect(res.status).toBe(200);

    // The tab's debounced full-set sync fires a beat later, still carrying the
    // rows the overwrite just removed. It must not resurrect them.
    const replay = await sync(user.token, tabRows);
    expect(replay.status).toBe(200);

    const active = (await fetchRows(user.token)).body;
    const activeIds = active.map((r: any) => r.id);
    expect(activeIds).not.toContain(stale[0].id);
    expect(activeIds).not.toContain(stale[1].id);
    expect(active).toHaveLength(res.body.rows.length);
  });
});

// ─────────────────────────────────────────────
// Root cause: duplicate check disagreed with what the user actually sees
// ─────────────────────────────────────────────
describe('GET /api/check/group/:groupNo', () => {
  it('does not report a group that only exists in the recycle bin', async () => {
    const user = await registerUser('chk_bin');
    const groupNo = `CHKBIN${Date.now()}`;
    const row = makeRow(`chk-bin-${Date.now()}`, groupNo);
    await sync(user.token, [row]);
    await request(app).post(`/api/data/${row.id}/delete`).set(auth(user.token)).send();

    const res = await request(app).get(`/api/check/group/${groupNo}`).set(auth(user.token));
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.count).toBe(0);
  });

  it('reports a group whose rows are shared with the user by someone else', async () => {
    const owner = await registerUser('chk_own');
    const receiver = await registerUser('chk_rcv');
    const groupNo = `CHKSHARE${Date.now()}`;
    const row = makeRow(`chk-share-${Date.now()}`, groupNo);
    await sync(owner.token, [row]);

    const invite = await request(app)
      .post('/api/shares/invitations')
      .set(auth(owner.token))
      .send({ receiverUsername: receiver.username, scopeType: 'group', groupNo });
    expect(invite.status).toBe(200);
    await request(app)
      .post(`/api/shares/invitations/${invite.body.invitation.id}/accept`)
      .set(auth(receiver.token))
      .send();

    // The receiver sees this group in the app, so the extension must warn them
    // before capturing it a second time.
    const res = await request(app).get(`/api/check/group/${groupNo}`).set(auth(receiver.token));
    expect(res.body.exists).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('matches a numeric stored groupNo against the string the extension sends', async () => {
    const user = await registerUser('chk_num');
    await sync(user.token, [makeRow(`chk-num-${Date.now()}`, 9911)]);

    const res = await request(app).get('/api/check/group/9911').set(auth(user.token));
    expect(res.body.exists).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Root cause: /api/data/sync re-created anything it could not find
// ─────────────────────────────────────────────
describe('POST /api/data/sync resurrection guard', () => {
  it('does not re-create a row that was permanently deleted', async () => {
    const user = await registerUser('res_purge');
    const row = makeRow(`res-purge-${Date.now()}`, 'RES-1');
    await sync(user.token, [row]);

    const seen = (await fetchRows(user.token)).body.find((r: any) => r.id === row.id);

    await request(app).post(`/api/data/${row.id}/delete`).set(auth(user.token)).send();
    await request(app).delete(`/api/data/${row.id}`).set(auth(user.token)).send();

    // A tab that never learned about the purge replays the row.
    const replay = await sync(user.token, [seen]);
    expect(replay.status).toBe(200);

    const activeIds = (await fetchRows(user.token)).body.map((r: any) => r.id);
    expect(activeIds).not.toContain(row.id);
  });

  it('still creates genuinely new rows that the client has never persisted', async () => {
    const user = await registerUser('res_new');
    const row = makeRow(`res-new-${Date.now()}`, 'RES-2');

    const res = await sync(user.token, [row]);
    expect(res.status).toBe(200);

    const activeIds = (await fetchRows(user.token)).body.map((r: any) => r.id);
    expect(activeIds).toContain(row.id);
  });
});

// ─────────────────────────────────────────────
// Root cause: delete/restore were not idempotent, so stale rows were undeletable
// ─────────────────────────────────────────────
describe('Delete and restore idempotency', () => {
  it('succeeds when the row was already moved to the recycle bin', async () => {
    const user = await registerUser('del_twice');
    const row = makeRow(`del-twice-${Date.now()}`, 'DEL-1');
    await sync(user.token, [row]);

    const first = await request(app).post(`/api/data/${row.id}/delete`).set(auth(user.token)).send();
    expect(first.status).toBe(200);

    // The browser retries because its first attempt looked like it failed.
    const second = await request(app).post(`/api/data/${row.id}/delete`).set(auth(user.token)).send();
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
  });

  it('succeeds when the row no longer exists at all', async () => {
    const user = await registerUser('del_gone');
    const res = await request(app)
      .post(`/api/data/does-not-exist-${Date.now()}/delete`)
      .set(auth(user.token))
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.alreadyDeleted).toBe(true);
  });

  it('still refuses a delete from a viewer who lacks edit permission', async () => {
    const owner = await registerUser('del_own');
    const viewer = await registerUser('del_view');
    const groupNo = `DELVIEW${Date.now()}`;
    const row = makeRow(`del-view-${Date.now()}`, groupNo);
    await sync(owner.token, [row]);

    const invite = await request(app)
      .post('/api/shares/invitations')
      .set(auth(owner.token))
      .send({ receiverUsername: viewer.username, scopeType: 'group', groupNo, role: 'viewer' });
    await request(app)
      .post(`/api/shares/invitations/${invite.body.invitation.id}/accept`)
      .set(auth(viewer.token))
      .send();

    const res = await request(app).post(`/api/data/${row.id}/delete`).set(auth(viewer.token)).send();
    expect(res.status).toBe(403);
  });

  it('succeeds when restoring a row that is already active', async () => {
    const user = await registerUser('res_twice');
    const row = makeRow(`res-twice-${Date.now()}`, 'RES-3');
    await sync(user.token, [row]);
    await request(app).post(`/api/data/${row.id}/delete`).set(auth(user.token)).send();

    const first = await request(app).post(`/api/data/${row.id}/restore`).set(auth(user.token)).send();
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/data/${row.id}/restore`).set(auth(user.token)).send();
    expect(second.status).toBe(200);
  });

  it('succeeds when permanently deleting a row that is already gone', async () => {
    const user = await registerUser('purge_gone');
    const row = makeRow(`purge-gone-${Date.now()}`, 'PURGE-1');
    await sync(user.token, [row]);
    await request(app).post(`/api/data/${row.id}/delete`).set(auth(user.token)).send();

    const first = await request(app).delete(`/api/data/${row.id}`).set(auth(user.token)).send();
    expect(first.status).toBe(200);
    const second = await request(app).delete(`/api/data/${row.id}`).set(auth(user.token)).send();
    expect(second.status).toBe(200);
  });
});

// ─────────────────────────────────────────────
// Root cause: purging one row blanked the whole client-side trash mirror
// ─────────────────────────────────────────────
describe('DELETE /api/data/:id settings side effects', () => {
  it('does not blank the stored deletedRows mirror when purging a single row', async () => {
    const user = await registerUser('purge_set');
    const keep = makeRow(`purge-keep-${Date.now()}`, 'PS-1');
    const drop = makeRow(`purge-drop-${Date.now()}`, 'PS-2');
    await sync(user.token, [keep, drop]);
    await request(app).post(`/api/data/${keep.id}/delete`).set(auth(user.token)).send();
    await request(app).post(`/api/data/${drop.id}/delete`).set(auth(user.token)).send();

    await request(app)
      .post('/api/settings')
      .set(auth(user.token))
      .send({ deletedRows: [keep, drop] });

    await request(app).delete(`/api/data/${drop.id}`).set(auth(user.token)).send();

    const settings = await request(app).get('/api/settings').set(auth(user.token));
    const storedIds = (settings.body.deletedRows || []).map((r: any) => r.id);
    expect(storedIds).toContain(keep.id);
    expect(storedIds).not.toContain(drop.id);
  });
});

// ─────────────────────────────────────────────
// Bulk operations: one atomic request instead of N racing ones
// ─────────────────────────────────────────────
describe('POST /api/data/bulk', () => {
  it('moves many rows to the recycle bin in a single request', async () => {
    const user = await registerUser('bulk_del');
    const rows = Array.from({ length: 5 }, (_, i) => makeRow(`bulk-del-${i}-${Date.now()}`, 'BULK-1'));
    await sync(user.token, rows);

    const res = await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'delete', ids: rows.map(r => r.id) });

    expect(res.status).toBe(200);
    expect(res.body.processed).toHaveLength(5);
    expect(res.body.failed).toHaveLength(0);
    expect((await fetchRows(user.token)).body).toHaveLength(0);
  });

  it('reports per-row failures instead of failing the whole batch', async () => {
    const user = await registerUser('bulk_part');
    const row = makeRow(`bulk-part-${Date.now()}`, 'BULK-2');
    await sync(user.token, [row]);

    const res = await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'delete', ids: [row.id, `ghost-${Date.now()}`] });

    expect(res.status).toBe(200);
    // A row that is already gone counts as done, not as a failure — that is what
    // made the old all-or-nothing bulk delete impossible to retry out of.
    expect(res.body.processed).toContain(row.id);
    expect(res.body.failed).toHaveLength(0);
  });

  it('restores many rows in a single request', async () => {
    const user = await registerUser('bulk_res');
    const rows = Array.from({ length: 3 }, (_, i) => makeRow(`bulk-res-${i}-${Date.now()}`, 'BULK-3'));
    await sync(user.token, rows);
    await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'delete', ids: rows.map(r => r.id) });

    const res = await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'restore', ids: rows.map(r => r.id) });

    expect(res.status).toBe(200);
    expect((await fetchRows(user.token)).body).toHaveLength(3);
  });

  it('permanently deletes many rows in a single request', async () => {
    const user = await registerUser('bulk_purge');
    const rows = Array.from({ length: 3 }, (_, i) => makeRow(`bulk-purge-${i}-${Date.now()}`, 'BULK-4'));
    await sync(user.token, rows);
    await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'delete', ids: rows.map(r => r.id) });

    const res = await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'purge', ids: rows.map(r => r.id) });

    expect(res.status).toBe(200);
    expect((await fetchDeleted(user.token)).body).toHaveLength(0);
  });

  it('rejects an unknown action', async () => {
    const user = await registerUser('bulk_bad');
    const res = await request(app)
      .post('/api/data/bulk')
      .set(auth(user.token))
      .send({ action: 'explode', ids: [] });

    expect(res.status).toBe(400);
  });
});
