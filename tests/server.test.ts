import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server';

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

  it('can sync an empty array (clears all rows)', async () => {
    // First sync some rows
    await authPost('/api/data/sync').send({ rows: sampleRows });
    // Then clear them
    const res = await authPost('/api/data/sync').send({ rows: [] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await authGet('/api/data');
    expect(getRes.body).toHaveLength(0);
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

  it('sync replaces existing rows (not appends)', async () => {
    // Sync 2 rows
    await authPost('/api/data/sync').send({ rows: sampleRows });
    // Sync 1 different row
    const newRow = [{ ...sampleRows[0], id: 'row_new' }];
    await authPost('/api/data/sync').send({ rows: newRow });

    const res = await authGet('/api/data');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('row_new');
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
    expect(res.body.notifiedIds).toEqual(['id1', 'id2']);
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
    const { fontSize: _, ...noFontSize } = sampleSettings;
    await authPost('/api/settings').send(noFontSize);
    const res = await authGet('/api/settings');
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
});
