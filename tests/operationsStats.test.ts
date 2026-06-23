import { describe, expect, it } from 'vitest';
import { countUniqueGroups } from '../utils/operationsStats';
import { LogisticsRow } from '../types';

const row = (groupNo: string, index: number): LogisticsRow => ({
  id: `row-${index}`,
  groupNo,
  groupName: '',
  agency: '',
  count: '',
  Column1: '',
  date: '',
  time: '',
  flight: '',
  from: '',
  to: '',
  carType: '',
  tafweej: '',
  status: 'Planned',
});

describe('operations stats', () => {
  it('counts each non-empty group number once', () => {
    expect(countUniqueGroups([
      row('1001', 1),
      row('1001', 2),
      row(' 1002 ', 3),
      row('1002', 4),
      row('', 5),
      row('   ', 6),
    ])).toBe(2);
  });
});
