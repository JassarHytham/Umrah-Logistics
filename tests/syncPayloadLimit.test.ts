import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../server';

describe('trip sync request size', () => {
  it('accepts a valid trip payload just over the general 2 MiB JSON limit', async () => {
    const admin = await request(app).post('/api/auth/login').send({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    });
    expect(admin.status).toBe(200);

    const credentials = { username: `sync_limit_${Date.now()}`, password: 'Password123!' };
    const created = await request(app).post('/api/admin/users')
      .set('Authorization', `Bearer ${admin.body.token}`).send(credentials);
    expect(created.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send(credentials);
    expect(login.status).toBe(200);

    const row = { id: `large-sync-${Date.now()}`, notes: 'x'.repeat(2 * 1024 * 1024 + 128) };
    const sync = await request(app).post('/api/data/sync')
      .set('Authorization', `Bearer ${login.body.token}`).send({ rows: [row] });

    expect(sync.status).toBe(200);
    expect(sync.body).toEqual({ success: true });
  });
});
