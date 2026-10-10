import { describe, expect, it } from 'vitest';
import { formatSyncError, summarizeSyncResults } from '../utils/syncError';

describe('sync error details', () => {
  it('identifies an oversized trip request and its HTTP status', () => {
    const error = Object.assign(new Error('request entity too large'), { status: 413 });
    const message = formatSyncError('trips', error);
    expect(message).toContain('الرحلات');
    expect(message).toContain('413');
    expect(message).toContain('حجم');
  });

  it('identifies a settings failure and preserves the server reason', () => {
    const error = Object.assign(new Error('Settings are locked'), { status: 503 });
    const message = formatSyncError('settings', error);
    expect(message).toContain('الإعدادات');
    expect(message).toContain('503');
    expect(message).toContain('Settings are locked');
  });

  it('explains a network failure without inventing an HTTP status', () => {
    const message = formatSyncError('trips', new TypeError('Failed to fetch'));
    expect(message).toContain('الاتصال');
    expect(message).not.toContain('HTTP');
  });

  it('reports both failed operations instead of losing the second rejection', () => {
    const result = summarizeSyncResults([
      { status: 'rejected', reason: Object.assign(new Error('request entity too large'), { status: 413 }) },
      { status: 'rejected', reason: Object.assign(new Error('Settings are locked'), { status: 503 }) },
    ]);
    expect(result.needsReload).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toContain('الرحلات');
    expect(result.messages[1]).toContain('الإعدادات');
  });

  it('reconciles a row conflict while still reporting a settings failure', () => {
    const result = summarizeSyncResults([
      { status: 'rejected', reason: Object.assign(new Error('Trip was updated elsewhere'), { status: 409 }) },
      { status: 'rejected', reason: Object.assign(new Error('Settings are locked'), { status: 503 }) },
    ]);
    expect(result.needsReload).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('الإعدادات');
  });
});
