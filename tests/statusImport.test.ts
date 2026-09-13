import { describe, expect, it } from 'vitest';
import { resolveImportedStatus } from '../utils/statusImport';

const LABELS = {
  'Planned': 'مخطط', 'Confirmed': 'مؤكد', 'Driver Assigned': 'تم تعيين السائق',
  'In Progress': 'قيد التنفيذ', 'Completed': 'مكتمل', 'Delayed': 'متأخر',
  'Cancelled': 'ملغي', 'Uncompleted': 'لم يكتمل', 'Hosting': 'استضافة',
} as const;

describe('resolveImportedStatus', () => {
  it('maps an exported Arabic status label back to its TripStatus', () => {
    expect(resolveImportedStatus('تم تعيين السائق', LABELS)).toBe('Driver Assigned');
  });

  it('accepts the raw English enum value, for a sheet edited by hand', () => {
    expect(resolveImportedStatus('Confirmed', LABELS)).toBe('Confirmed');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(resolveImportedStatus('  مؤكد  ', LABELS)).toBe('Confirmed');
  });

  it('defaults to Planned for a blank cell', () => {
    expect(resolveImportedStatus('', LABELS)).toBe('Planned');
  });

  it('defaults to Planned for an unrecognized value instead of throwing', () => {
    expect(resolveImportedStatus('garbage', LABELS)).toBe('Planned');
  });
});
