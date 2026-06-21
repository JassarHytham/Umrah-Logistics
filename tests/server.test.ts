import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'http';
import WebSocket from 'ws';
import { app, attachLiveUpdates } from '../server';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const TEST_USER = { username: `testuser_${Date.now()}`, password: 'Password123!' };
let authToken = '';
let userId: number;

const authGet = (path: string) =>
  request(app).get(path).set('Authorization', `Bearer ${authToken}`);
const authPost = (path: string) =>
  request(app).post(path).set('Authorization', `Bearer ${authToken}`);

const startLiveTestServer = async () => {
  const server = createServer(app);
  attachLiveUpdates(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start test server');
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}` };
};

const closeLiveTestServer = async (server: Server) => {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
};

const connectLiveSocket = async (wsUrl: string, token: string) => {
  const socket = new WebSocket(`${wsUrl}/api/live?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
};

const waitForLiveEvent = async (socket: WebSocket, expectedType: string) => {
  return await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), 1000);
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (message.type === expectedType) {
        clearTimeout(timeout);
        resolve(message);
      }
    });
  });
};

// Register once and reuse the token for all tests in this file
beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send(TEST_USER);
  authToken = res.body.token;
  userId = res.body.user?.id;
});

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('creates a new user and returns a token', async () => {
    const unique = `newuser_${Date.now()}`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: unique, password: 'pass123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.username).toBe(unique);
  });

  it('rejects duplicate username with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(TEST_USER); // already registered in beforeAll

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects missing username with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects missing password with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'someuser' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects empty body with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('returns token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send(TEST_USER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.username).toBe(TEST_USER.username);
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER.username, password: 'WrongPass!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('rejects non-existent user with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost_user_xyz', password: 'any' });

    expect(res.status).toBe(401);
  });

  it('token payload contains user id and username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send(TEST_USER);

    expect(res.body.user).toMatchObject({
      id: expect.any(Number),
      username: TEST_USER.username,
    });
  });
});

// ─────────────────────────────────────────────
// Auth Middleware
// ─────────────────────────────────────────────
describe('Auth Middleware', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(401);
  });

  it('returns 403 when token is invalid', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('Authorization', 'Bearer this.is.not.valid');
    expect(res.status).toBe(403);
  });

  it('returns 403 for malformed Authorization header (no Bearer prefix)', async () => {
    const res = await request(app)
      .get('/api/data')
      .set('Authorization', authToken); // missing "Bearer " prefix
    expect(res.status).toBe(401);
  });

  it('passes through with valid token', async () => {
    const res = await authGet('/api/data');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────
// GET /api/data
// ─────────────────────────────────────────────
describe('GET /api/data', () => {
  it('returns empty array for new user', async () => {
    const res = await authGet('/api/data');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────
// POST /api/data/sync
// ─────────────────────────────────────────────
describe('POST /api/data/sync', () => {
  const sampleRows = [
    {
      id: 'row1',
      groupNo: 'G001',
      groupName: 'Test Group',
      count: '4',
      Column1: 'وصول',
      date: '15/01/2024',
      time: '14:30',
      flight: 'SV123',
      from: 'جدة',
      to: 'مكة المكرمة',
      carType: 'سيدان',
      tafweej: 'Test',
      status: 'Planned',
    },
    {
      id: 'row2',
      groupNo: 'G001',
      groupName: 'Test Group',
      count: '4',
      Column1: 'مغادرة',
      date: '25/01/2024',
      time: '10:00',
      flight: 'SV456',
      from: 'مكة المكرمة',
      to: 'جدة',
      carType: 'سيدان',
      tafweej: 'Test',
      status: 'Confirmed',
    },
  ];

  it('requires authentication', async () => {
    const res = await request(app).post('/api/data/sync').send({ rows: [] });
    expect(res.status).toBe(401);
  });

  it('rejects non-array rows with 400', async () => {
    const res = await authPost('/api/data/sync').send({ rows: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('rejects missing rows field with 400', async () => {
    const res = await authPost('/api/data/sync').send({});
    expect(res.status).toBe(400);
  });

  it('syncs rows successfully', async () => {
    const res = await authPost('/api/data/sync').send({ rows: sampleRows });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('can sync an empty array without deleting omitted rows', async () => {
    // First sync some rows
    await authPost('/api/data/sync').send({ rows: sampleRows });
    // Empty sync is conservative: deletion must use explicit delete endpoints
    const res = await authPost('/api/data/sync').send({ rows: [] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await authGet('/api/data');
    expect(getRes.body).toHaveLength(2);
  });

  it('GET /api/data returns synced rows', async () => {
    await authPost('/api/data/sync').send({ rows: sampleRows });
    const res = await authGet('/api/data');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const ids = res.body.map((r: any) => r.id);
    expect(ids).toContain('row1');
    expect(ids).toContain('row2');
  });

  it('sync merges new rows without deleting omitted rows', async () => {
    // Sync 2 rows
    await authPost('/api/data/sync').send({ rows: sampleRows });
    // Sync 1 different row
    const newRow = [{ ...sampleRows[0], id: 'row_new' }];
    await authPost('/api/data/sync').send({ rows: newRow });

    const res = await authGet('/api/data');
    expect(res.body).toHaveLength(3);
    expect(res.body.map((r: any) => r.id)).toEqual(expect.arrayContaining(['row1', 'row2', 'row_new']));
  });

  it('preserves row data integrity through sync roundtrip', async () => {
    await authPost('/api/data/sync').send({ rows: [sampleRows[0]] });
    const res = await authGet('/api/data');

    const row = res.body[0];
    expect(row.groupNo).toBe(sampleRows[0].groupNo);
    expect(row.flight).toBe(sampleRows[0].flight);
    expect(row.status).toBe(sampleRows[0].status);
    expect(row.date).toBe(sampleRows[0].date);
  });

  it('data is user-isolated: another user does not see these rows', async () => {
    // Register a second user
    const user2 = { username: `user2_${Date.now()}`, password: 'pass' };
    const regRes = await request(app).post('/api/auth/register').send(user2);
    const token2 = regRes.body.token;

    // Sync rows for the primary test user
    await authPost('/api/data/sync').send({ rows: sampleRows });

    // Second user should see empty
    const res = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${token2}`);
    expect(res.body).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// GET /api/settings
// ─────────────────────────────────────────────
describe('GET /api/settings', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns default settings for new user', async () => {
    const newUser = { username: `fresh_${Date.now()}`, password: 'pass' };
    const reg = await request(app).post('/api/auth/register').send(newUser);
    const token = reg.body.token;

    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tgConfig).toBeNull();
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.fontSize).toBe(100);
  });
});

// ─────────────────────────────────────────────
// POST /api/settings
// ─────────────────────────────────────────────
describe('POST /api/settings', () => {
  const sampleSettings = {
    tgConfig: { token: 'bot123', chatId: '456', enabled: true, botName: 'TestBot' },
    templates: [{ id: 't1', name: 'Template 1', data: { Column1: 'وصول' } }],
    deletedRows: [],
    notifiedIds: ['id1', 'id2'],
    fontSize: 120,
  };

  it('requires authentication', async () => {
    const res = await request(app).post('/api/settings').send(sampleSettings);
    expect(res.status).toBe(401);
  });

  it('saves settings successfully', async () => {
    const res = await authPost('/api/settings').send(sampleSettings);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retrieves saved settings correctly', async () => {
    await authPost('/api/settings').send(sampleSettings);
    const res = await authGet('/api/settings');

    expect(res.body.fontSize).toBe(120);
    expect(res.body.tgConfig.token).toBe('bot123');
    expect(res.body.tgConfig.chatId).toBe('456');
    expect(res.body.tgConfig.enabled).toBe(true);
    expect(res.body.templates).toHaveLength(1);
    expect(res.body.templates[0].name).toBe('Template 1');
    expect(res.body.notifiedIds).toEqual([]); // server-managed; client writes are ignored
  });

  it('upserts settings (updates on second call)', async () => {
    await authPost('/api/settings').send(sampleSettings);
    const updated = { ...sampleSettings, fontSize: 150 };
    await authPost('/api/settings').send(updated);

    const res = await authGet('/api/settings');
    expect(res.body.fontSize).toBe(150);
  });

  it('saves null tgConfig correctly', async () => {
    await authPost('/api/settings').send({ ...sampleSettings, tgConfig: null });
    const res = await authGet('/api/settings');
    expect(res.body.tgConfig).toBeNull();
  });

  it('saves empty templates array', async () => {
    await authPost('/api/settings').send({ ...sampleSettings, templates: [] });
    const res = await authGet('/api/settings');
    expect(res.body.templates).toEqual([]);
  });

  it('defaults fontSize to 100 when not provided', async () => {
    const fresh = { username: `font_default_${Date.now()}`, password: 'pass' };
    const reg = await request(app).post('/api/auth/register').send(fresh);
    const token = reg.body.token;
    const { fontSize: _, ...noFontSize } = sampleSettings;
    await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send(noFontSize);
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.fontSize).toBe(100);
  });

  it('settings are user-isolated', async () => {
    // Save settings for primary user
    await authPost('/api/settings').send(sampleSettings);

    // Register a completely fresh user
    const fresh = { username: `isolated_${Date.now()}`, password: 'pass' };
    const reg = await request(app).post('/api/auth/register').send(fresh);
    const freshToken = reg.body.token;

    // Fresh user should have default settings
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(res.body.tgConfig).toBeNull();
    expect(res.body.fontSize).toBe(100);
  });

  it('client notifiedIds do not overwrite server-managed notified_ids', async () => {
    // Simulate the server alert worker writing notified_ids directly to the DB.
    // We test via the settings API: save with server-side notifiedIds via a
    // direct DB manipulation. Since we can't call the worker from tests,
    // we verify the inverse: client-sent notifiedIds are silently dropped,
    // and the field comes back as whatever the server set (empty for new user).
    await authPost('/api/settings').send({ ...sampleSettings, notifiedIds: ['server-managed-id'] });
    const res = await authGet('/api/settings');
    // notifiedIds from the client payload must be ignored — server starts fresh for this test user
    expect(res.body.notifiedIds).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// Shared Trips
// ─────────────────────────────────────────────
const registerSharedTestUser = async (prefix: string) => {
  const credentials = {
    username: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    password: 'pass123',
  };
  const res = await request(app).post('/api/auth/register').send(credentials);
  return { ...credentials, token: res.body.token, user: res.body.user };
};

const makeSharedTripRow = (id: string, groupNo = 'S001') => ({
  id,
  groupNo,
  groupName: 'Shared Group',
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

describe('Shared trip row invitations', () => {
  it('keeps a row hidden until invite acceptance, then exposes the same canonical row', async () => {
    const owner = await registerSharedTestUser('share_owner');
    const receiver = await registerSharedTestUser('share_receiver');
    const row = makeSharedTripRow(`shared-row-${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });

    const invite = await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });

    expect(invite.status).toBe(200);
    expect(invite.body.invitation.scopeType).toBe('row');

    const beforeAccept = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(beforeAccept.body).toHaveLength(0);

    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(pending.body).toHaveLength(1);

    const accept = await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();
    expect(accept.status).toBe(200);

    const afterAccept = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(afterAccept.body).toHaveLength(1);
    expect(afterAccept.body[0].id).toBe(row.id);
    expect(afterAccept.body[0]._sharing.shared).toBe(true);
    expect(afterAccept.body[0]._sharing.ownerUsername).toBe(owner.username);
  });

  it('declining a row invitation does not grant access', async () => {
    const owner = await registerSharedTestUser('decline_owner');
    const receiver = await registerSharedTestUser('decline_receiver');
    const row = makeSharedTripRow(`declined-row-${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });

    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });

    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);

    const decline = await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/decline`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();
    expect(decline.status).toBe(200);

    const rows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(rows.body).toHaveLength(0);
  });
});

describe('Shared trip editing and group membership', () => {
  it('lets an accepted row collaborator edit the canonical row for the owner', async () => {
    const owner = await registerSharedTestUser('edit_owner');
    const receiver = await registerSharedTestUser('edit_receiver');
    const row = makeSharedTripRow(`edit-row-${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });

    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const patch = await request(app)
      .patch(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ updates: { status: 'Confirmed', notes: 'Updated by receiver' } });
    expect(patch.status).toBe(200);

    const ownerRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    const ownerRow = ownerRows.body.find((r: any) => r.id === row.id);
    expect(ownerRow.status).toBe('Confirmed');
    expect(ownerRow.notes).toBe('Updated by receiver');
  });

  it('shares current and future group rows created by any accepted collaborator', async () => {
    const owner = await registerSharedTestUser('group_owner');
    const receiver = await registerSharedTestUser('group_receiver');
    const groupNo = `G${Date.now()}`;
    const originalRow = makeSharedTripRow(`group-row-1-${Date.now()}`, groupNo);
    const futureRow = makeSharedTripRow(`group-row-2-${Date.now()}`, groupNo);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [originalRow] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'group', groupNo });

    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const receiverRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(receiverRows.body.map((r: any) => r.id)).toContain(originalRow.id);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ rows: [futureRow] });

    const ownerRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRows.body.map((r: any) => r.id)).toContain(futureRow.id);
  });
});

describe('Shared trip delete and restore', () => {
  it('moves a shared deleted row to every collaborator recycle bin and allows restore', async () => {
    const owner = await registerSharedTestUser('delete_owner');
    const receiver = await registerSharedTestUser('delete_receiver');
    const row = makeSharedTripRow(`delete-shared-row-${Date.now()}`, `DEL${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });
    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const del = await request(app)
      .post(`/api/data/${row.id}/delete`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();
    expect(del.status).toBe(200);

    const ownerActive = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    const receiverActive = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(ownerActive.body.map((r: any) => r.id)).not.toContain(row.id);
    expect(receiverActive.body.map((r: any) => r.id)).not.toContain(row.id);

    const ownerDeleted = await request(app)
      .get('/api/data/deleted')
      .set('Authorization', `Bearer ${owner.token}`);
    const receiverDeleted = await request(app)
      .get('/api/data/deleted')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(ownerDeleted.body.map((r: any) => r.id)).toContain(row.id);
    expect(receiverDeleted.body.map((r: any) => r.id)).toContain(row.id);
    expect(ownerDeleted.body.find((r: any) => r.id === row.id)._sharing.deletedByUsername).toBe(receiver.username);

    const restore = await request(app)
      .post(`/api/data/${row.id}/restore`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send();
    expect(restore.status).toBe(200);

    const receiverRestored = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(receiverRestored.body.map((r: any) => r.id)).toContain(row.id);
  });

  it('blocks unauthorized users from editing, deleting, restoring, or inviting hidden rows', async () => {
    const owner = await registerSharedTestUser('auth_owner');
    const outsider = await registerSharedTestUser('auth_outsider');
    const row = makeSharedTripRow(`auth-row-${Date.now()}`, `AUTH${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });

    const patch = await request(app)
      .patch(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ updates: { status: 'Confirmed' } });
    expect(patch.status).toBe(404);

    const del = await request(app)
      .post(`/api/data/${row.id}/delete`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send();
    expect(del.status).toBe(404);

    const restore = await request(app)
      .post(`/api/data/${row.id}/restore`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send();
    expect(restore.status).toBe(404);

    const invite = await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ receiverUsername: owner.username, scopeType: 'row', rowId: row.id });
    expect(invite.status).toBe(404);
  });
});

describe('Shared trip sync compatibility', () => {
  it('updates visible shared rows during sync without taking ownership or deleting omitted rows', async () => {
    const owner = await registerSharedTestUser('sync_owner');
    const receiver = await registerSharedTestUser('sync_receiver');
    const row = makeSharedTripRow(`sync-shared-row-${Date.now()}`, `SYNC${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });
    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const sync = await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ rows: [{ ...row, status: 'Confirmed' }] });
    expect(sync.status).toBe(200);

    const ownerRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRows.body.find((r: any) => r.id === row.id).status).toBe('Confirmed');

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ rows: [] });

    const receiverRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(receiverRows.body.map((r: any) => r.id)).toContain(row.id);
  });

  it('does not persist client-returned sharing metadata into canonical row data', async () => {
    const owner = await registerSharedTestUser('metadata_owner');
    const row = {
      ...makeSharedTripRow(`metadata-row-${Date.now()}`, `META${Date.now()}`),
      _sharing: { shared: true, ownerUsername: 'client-copy', scope: 'row' },
    };

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });

    const rows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(rows.body.find((r: any) => r.id === row.id)._sharing).toBeUndefined();
  });
});

describe('Shared trip access roles and management', () => {
  it('lets owners list, change, and revoke granted shared access', async () => {
    const owner = await registerSharedTestUser('manage_owner');
    const receiver = await registerSharedTestUser('manage_receiver');
    const row = makeSharedTripRow(`manage-row-${Date.now()}`, `MANAGE${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id, role: 'viewer' });

    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const access = await request(app)
      .get('/api/shares/access')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(access.status).toBe(200);
    expect(access.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        username: receiver.username,
        role: 'viewer',
        scopeType: 'row',
        rowId: row.id,
      }),
    ]));

    const update = await request(app)
      .patch('/api/shares/access')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ scopeType: 'row', rowId: row.id, userId: receiver.user.id, role: 'editor' });
    expect(update.status).toBe(200);

    const updatedAccess = await request(app)
      .get('/api/shares/access')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(updatedAccess.body.find((item: any) => item.userId === receiver.user.id).role).toBe('editor');

    const revoke = await request(app)
      .delete('/api/shares/access')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ scopeType: 'row', rowId: row.id, userId: receiver.user.id });
    expect(revoke.status).toBe(200);

    const receiverRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(receiverRows.body.map((r: any) => r.id)).not.toContain(row.id);
  });

  it('prevents viewer collaborators from editing or deleting shared trips', async () => {
    const owner = await registerSharedTestUser('viewer_owner');
    const receiver = await registerSharedTestUser('viewer_receiver');
    const row = makeSharedTripRow(`viewer-row-${Date.now()}`, `VIEW${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id, role: 'viewer' });

    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const rows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    expect(rows.body.map((r: any) => r.id)).toContain(row.id);

    const patch = await request(app)
      .patch(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ updates: { status: 'Confirmed' } });
    expect(patch.status).toBe(403);

    const del = await request(app)
      .post(`/api/data/${row.id}/delete`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();
    expect(del.status).toBe(403);
  });
});

describe('Row conflict protection', () => {
  it('rejects stale row updates with a conflict response', async () => {
    const owner = await registerSharedTestUser('conflict_owner');
    const row = makeSharedTripRow(`conflict-row-${Date.now()}`, `CONFLICT${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });

    const initial = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    const version = initial.body.find((r: any) => r.id === row.id)._version;

    const first = await request(app)
      .patch(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ updates: { status: 'Confirmed' }, baseVersion: version });
    expect(first.status).toBe(200);

    const stale = await request(app)
      .patch(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ updates: { status: 'Delayed' }, baseVersion: version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(stale.body.row.status).toBe('Confirmed');
    expect(stale.body.row._version).toBeGreaterThan(version);
  });

  it('allows a stale full-table sync when the row already matches the saved edit', async () => {
    const owner = await registerSharedTestUser('same_sync_owner');
    const receiver = await registerSharedTestUser('same_sync_receiver');
    const row = makeSharedTripRow(`same-sync-row-${Date.now()}`, `SAMESYNC${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id, role: 'editor' });
    const pending = await request(app)
      .get('/api/shares/invitations')
      .set('Authorization', `Bearer ${receiver.token}`);
    await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();

    const receiverRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${receiver.token}`);
    const loadedRow = receiverRows.body.find((r: any) => r.id === row.id);

    const patch = await request(app)
      .patch(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ updates: { status: 'Confirmed' }, baseVersion: loadedRow._version });
    expect(patch.status).toBe(200);

    const staleButSame = { ...loadedRow, status: 'Confirmed' };
    const sync = await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ rows: [staleButSame] });
    expect(sync.status).toBe(200);

    const ownerRows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRows.body.find((r: any) => r.id === row.id).status).toBe('Confirmed');
  });
});

describe('Extension text ingest with deleted rows', () => {
  it('does not resurrect rows that were moved to the recycle bin', async () => {
    const user = await registerSharedTestUser('ingest_deleted_user');
    const deletedRows = [
      makeSharedTripRow(`deleted-ingest-row-1-${Date.now()}`, `INGDEL${Date.now()}`),
      makeSharedTripRow(`deleted-ingest-row-2-${Date.now()}`, `INGDEL${Date.now()}`),
    ];

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ rows: deletedRows });

    await Promise.all(deletedRows.map(row =>
      request(app)
        .post(`/api/data/${row.id}/delete`)
        .set('Authorization', `Bearer ${user.token}`)
        .send()
    ));

    const activeAfterDelete = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${user.token}`);
    expect(activeAfterDelete.body).toHaveLength(0);

    const ingestText = `
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

    const ingest = await request(app)
      .post('/api/ingest/text')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        text: ingestText,
        groupNo: `NEW${Date.now()}`,
        groupName: 'New Group',
        count: '4',
      });
    expect(ingest.status).toBe(200);

    const activeAfterIngest = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${user.token}`);
    const activeIds = activeAfterIngest.body.map((row: any) => row.id);
    expect(activeIds).not.toContain(deletedRows[0].id);
    expect(activeIds).not.toContain(deletedRows[1].id);
    expect(activeAfterIngest.body).toHaveLength(ingest.body.rows.length);
  });
});

describe('Recycle bin permanent deletion', () => {
  it('permanently deletes a single deleted row', async () => {
    const user = await registerSharedTestUser('hard_delete_user');
    const row = makeSharedTripRow(`hard-delete-row-${Date.now()}`, `HARD${Date.now()}`);

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ rows: [row] });

    await request(app)
      .post(`/api/data/${row.id}/delete`)
      .set('Authorization', `Bearer ${user.token}`)
      .send();

    const hardDelete = await request(app)
      .delete(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send();
    expect(hardDelete.status).toBe(200);

    const deletedRows = await request(app)
      .get('/api/data/deleted')
      .set('Authorization', `Bearer ${user.token}`);
    expect(deletedRows.body.map((r: any) => r.id)).not.toContain(row.id);
  });

  it('permanently clears all owned deleted rows from the recycle bin', async () => {
    const user = await registerSharedTestUser('clear_deleted_user');
    const rows = [
      makeSharedTripRow(`clear-deleted-row-1-${Date.now()}`, `CLR${Date.now()}`),
      makeSharedTripRow(`clear-deleted-row-2-${Date.now()}`, `CLR${Date.now()}`),
    ];

    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ rows });

    await Promise.all(rows.map(row =>
      request(app)
        .post(`/api/data/${row.id}/delete`)
        .set('Authorization', `Bearer ${user.token}`)
        .send()
    ));

    const clear = await request(app)
      .delete('/api/data/deleted')
      .set('Authorization', `Bearer ${user.token}`)
      .send();
    expect(clear.status).toBe(200);
    expect(clear.body.deletedCount).toBe(2);

    const deletedRows = await request(app)
      .get('/api/data/deleted')
      .set('Authorization', `Bearer ${user.token}`);
    expect(deletedRows.body).toHaveLength(0);
  });
});

describe('Live update websocket invalidation', () => {
  it('notifies a receiver when a share invitation is created', async () => {
    const { server, baseUrl, wsUrl } = await startLiveTestServer();
    let socket: WebSocket | null = null;

    try {
      const owner = await registerSharedTestUser('live_invite_owner');
      const receiver = await registerSharedTestUser('live_invite_receiver');
      const row = makeSharedTripRow(`live-invite-row-${Date.now()}`, `LIVE${Date.now()}`);

      await request(baseUrl)
        .post('/api/data/sync')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ rows: [row] });

      socket = await connectLiveSocket(wsUrl, receiver.token);
      const eventPromise = waitForLiveEvent(socket, 'invitations_changed');

      await request(baseUrl)
        .post('/api/shares/invitations')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });

      const event = await eventPromise;
      expect(event.type).toBe('invitations_changed');
    } finally {
      socket?.close();
      await closeLiveTestServer(server);
    }
  });

  it('notifies shared row collaborators when a row is edited', async () => {
    const { server, baseUrl, wsUrl } = await startLiveTestServer();
    let ownerSocket: WebSocket | null = null;

    try {
      const owner = await registerSharedTestUser('live_edit_owner');
      const receiver = await registerSharedTestUser('live_edit_receiver');
      const row = makeSharedTripRow(`live-edit-row-${Date.now()}`, `LIVEEDIT${Date.now()}`);

      await request(baseUrl)
        .post('/api/data/sync')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ rows: [row] });
      await request(baseUrl)
        .post('/api/shares/invitations')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });
      const pending = await request(baseUrl)
        .get('/api/shares/invitations')
        .set('Authorization', `Bearer ${receiver.token}`);
      await request(baseUrl)
        .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
        .set('Authorization', `Bearer ${receiver.token}`)
        .send();

      ownerSocket = await connectLiveSocket(wsUrl, owner.token);
      const eventPromise = waitForLiveEvent(ownerSocket, 'rows_changed');

      await request(baseUrl)
        .patch(`/api/data/${row.id}`)
        .set('Authorization', `Bearer ${receiver.token}`)
        .send({ updates: { status: 'Confirmed' } });

      const event = await eventPromise;
      expect(event.type).toBe('rows_changed');
      expect(event.actorUserId).toBe(receiver.user.id);
    } finally {
      ownerSocket?.close();
      await closeLiveTestServer(server);
    }
  });

  it('notifies group collaborators when a future group row is synced', async () => {
    const { server, baseUrl, wsUrl } = await startLiveTestServer();
    let ownerSocket: WebSocket | null = null;

    try {
      const owner = await registerSharedTestUser('live_group_owner');
      const receiver = await registerSharedTestUser('live_group_receiver');
      const groupNo = `LIVEGROUP${Date.now()}`;
      const originalRow = makeSharedTripRow(`live-group-row-1-${Date.now()}`, groupNo);
      const futureRow = makeSharedTripRow(`live-group-row-2-${Date.now()}`, groupNo);

      await request(baseUrl)
        .post('/api/data/sync')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ rows: [originalRow] });
      await request(baseUrl)
        .post('/api/shares/invitations')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ receiverUsername: receiver.username, scopeType: 'group', groupNo });
      const pending = await request(baseUrl)
        .get('/api/shares/invitations')
        .set('Authorization', `Bearer ${receiver.token}`);
      await request(baseUrl)
        .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
        .set('Authorization', `Bearer ${receiver.token}`)
        .send();

      ownerSocket = await connectLiveSocket(wsUrl, owner.token);
      const eventPromise = waitForLiveEvent(ownerSocket, 'rows_changed');

      await request(baseUrl)
        .post('/api/data/sync')
        .set('Authorization', `Bearer ${receiver.token}`)
        .send({ rows: [futureRow] });

      const event = await eventPromise;
      expect(event.type).toBe('rows_changed');
    } finally {
      ownerSocket?.close();
      await closeLiveTestServer(server);
    }
  });
});
