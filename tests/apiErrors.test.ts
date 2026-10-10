import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';

afterEach(() => vi.unstubAllGlobals());

describe('API errors', () => {
  it('keeps the HTTP status when a proxy returns a non-JSON error page', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(api.request('/data/sync')).rejects.toMatchObject({ status: 502 });
  });
});
