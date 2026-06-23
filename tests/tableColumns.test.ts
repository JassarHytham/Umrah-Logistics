import { describe, expect, it } from 'vitest';
import { COLUMN_LABELS, DEFAULT_COLUMN_ORDER } from '../types';

describe('table column constants', () => {
  it('exposes agency as الوكيل near group metadata', () => {
    expect(COLUMN_LABELS.agency).toBe('الوكيل');
    expect(DEFAULT_COLUMN_ORDER).toContain('agency');
    expect(DEFAULT_COLUMN_ORDER.indexOf('agency')).toBeGreaterThan(DEFAULT_COLUMN_ORDER.indexOf('groupName'));
    expect(DEFAULT_COLUMN_ORDER.indexOf('agency')).toBeLessThan(DEFAULT_COLUMN_ORDER.indexOf('Column1'));
  });
});
