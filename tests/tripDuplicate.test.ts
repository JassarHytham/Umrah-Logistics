import { describe, expect, it } from 'vitest';
import { areTripsEquivalent, normalizeTripValue } from '../utils/tripDuplicate';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'row-a', groupNo: '123', groupName: 'Group A', agency: '', count: '20',
  Column1: 'Arrival', date: '2026-11-02', time: '09:30', flight: 'XY123',
  from: 'Jeddah Airport', to: 'Hotel One (Makkah)', carType: 'Bus',
  tafweej: 'Arrival — Jeddah Airport → Hotel One (Makkah)', status: 'Planned', ...overrides,
});

describe('trip duplicate normalization', () => {
  it('normalizes Arabic digits, Arabic letter variants, marks, and whitespace', () => {
    expect(normalizeTripValue('  أَحْمَدــ  ١٢  ')).toBe('احمد 12');
  });

  it('treats whitespace, case, Arabic digits, and equivalent date/time formats as equal', () => {
    expect(areTripsEquivalent(
      row({ groupNo: '123', groupName: 'Group A', date: '02/11/2026', time: '9:30' }),
      row({ id: 'row-b', groupNo: '١٢٣', groupName: '  group   a ', date: '2026-11-02', time: '09:30:00' }),
    )).toBe(true);
    expect(areTripsEquivalent(row({ time: '9:30 PM' }), row({ id: 'row-b', time: '21:30' }))).toBe(true);
  });

  it.each([
    ['arrival date', { date: '2026-11-03' }],
    ['departure time', { time: '10:30' }],
    ['flight number', { flight: 'XY124' }],
    ['city leg', { to: 'Hotel One (Madinah)' }],
    ['hotel', { to: 'Hotel Two (Makkah)' }],
    ['unknown business key', { routeLeg: 'Makkah to Madinah' }],
  ])('keeps trips when only %s differs', (_label, changed) => {
    expect(areTripsEquivalent(row(), row({ id: 'row-b', ...changed }))).toBe(false);
  });

  it('ignores operational and system fields but compares unknown business keys', () => {
    expect(areTripsEquivalent(row(), row({
      id: 'row-b', status: 'Completed', notes: 'Called driver', _version: 3,
      updated_at: '2026-11-01T10:00:00Z', source: 'extension', batchId: 'batch-2',
    }))).toBe(true);
  });

  it('treats missing, null, and blank optional business values as equal', () => {
    expect(areTripsEquivalent(row(), row({ id: 'row-b', agency: null }))).toBe(true);
    expect(areTripsEquivalent(row({ customLeg: null }), row({ id: 'row-b', customLeg: '   ' }))).toBe(true);
  });
});
