import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Exercise the real production limiters; disable only the test-environment bypass.
vi.mock('express-rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('express-rate-limit')>();
  return {
    ...actual,
    default: (options: any) => actual.default({ ...options, skip: () => false }),
  };
});

import { app } from '../server';

describe('production rate limits behind the local reverse proxy', () => {
  it('keeps separate client allowances and returns JSON when one is exhausted', async () => {
    for (let i = 0; i < 600; i++) {
      const response = await request(app).get('/api/data').set('X-Forwarded-For', '198.51.100.10');
      expect(response.status).toBe(401);
    }
    const blocked = await request(app).get('/api/data').set('X-Forwarded-For', '198.51.100.10');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/json');
    expect(blocked.body.error).toEqual(expect.any(String));
    const otherClient = await request(app).get('/api/data').set('X-Forwarded-For', '198.51.100.11');
    expect(otherClient.status).toBe(401);
  });

  it('returns JSON when login attempts exhaust their separate limit', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await request(app).post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.12').send({});
      expect(response.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.12').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/json');
    expect(blocked.body.error).toEqual(expect.any(String));
  });

  it('uses the closest untrusted address rather than a spoofed forwarded prefix', async () => {
    const trust = app.get('trust proxy fn');
    expect(trust('127.0.0.1')).toBe(true);
    expect(trust('::1')).toBe(true);
    expect(trust('198.51.100.20')).toBe(false);
    const response = await request(app).get('/api/data')
      .set('X-Forwarded-For', '198.51.100.99, 198.51.100.10');
    expect(response.status).toBe(429);
  });
});
