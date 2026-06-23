import { describe, expect, it } from 'vitest';
import { COLUMN_LABELS, DEFAULT_COLUMN_ORDER, normalizeDisplaySettings } from '../types';

describe('table column constants', () => {
  it('exposes agency as الوكيل near group metadata', () => {
    expect(COLUMN_LABELS.agency).toBe('الوكيل');
    expect(DEFAULT_COLUMN_ORDER).toContain('agency');
    expect(DEFAULT_COLUMN_ORDER.indexOf('agency')).toBeGreaterThan(DEFAULT_COLUMN_ORDER.indexOf('groupName'));
    expect(DEFAULT_COLUMN_ORDER.indexOf('agency')).toBeLessThan(DEFAULT_COLUMN_ORDER.indexOf('Column1'));
  });

  it('uses stable agency labels for import and export mapping', () => {
    const agencyLabels = ['الوكيل', 'اسم الوكيل الرئيسي', 'Agency', 'Main Agent', 'اسم_الوكيل_الرئيسي'];
    expect(agencyLabels).toContain(COLUMN_LABELS.agency);
  });

  it('adds agency to existing saved column orders that predate the column', () => {
    const normalized = normalizeDisplaySettings({
      columnOrder: ['status', 'groupNo', 'groupName', 'Column1', 'actions'],
    });

    expect(normalized.columnOrder).toContain('agency');
    expect(normalized.columnOrder.indexOf('agency')).toBeGreaterThan(normalized.columnOrder.indexOf('groupName'));
    expect(normalized.columnOrder.indexOf('agency')).toBeLessThan(normalized.columnOrder.indexOf('Column1'));
  });
});
