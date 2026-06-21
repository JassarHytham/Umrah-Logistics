import { describe, expect, it } from 'vitest';
import { LogisticsRow } from '../types';
import { markRowsDeleted, removeDeletedRows, restoreRows } from '../utils/rowStateActions';

const row = (id: string, extras: Partial<LogisticsRow> = {}): LogisticsRow => ({
  id,
  groupNo: 'G1',
  groupName: 'Group',
  count: '1',
  Column1: 'Arrival',
  date: '01/01/2026',
  time: '10:00',
  flight: 'SV1',
  from: 'JED',
  to: 'Makkah',
  carType: 'Sedan',
  tafweej: '',
  status: 'Planned',
  ...extras,
});

describe('row state actions', () => {
  it('moves deleted rows out of active rows without reloading all data', () => {
    const activeRows = [row('a'), row('b')];
    const deletedRows = [row('old')];

    const next = markRowsDeleted(activeRows, deletedRows, ['a'], 'editor');

    expect(next.activeRows.map(r => r.id)).toEqual(['b']);
    expect(next.deletedRows.map(r => r.id)).toEqual(['a', 'old']);
    expect(next.deletedRows[0]._sharing?.deletedByUsername).toBe('editor');
    expect(next.deletedRows[0]._sharing?.deletedAt).toBeTruthy();
  });

  it('restores deleted rows into active rows without deleted metadata', () => {
    const activeRows = [row('active')];
    const deletedRows = [
      row('deleted', { _sharing: { shared: true, ownerUsername: 'owner', deletedByUsername: 'editor', deletedAt: 'now' } }),
    ];

    const next = restoreRows(activeRows, deletedRows, ['deleted']);

    expect(next.activeRows.map(r => r.id)).toEqual(['deleted', 'active']);
    expect(next.deletedRows).toEqual([]);
    expect(next.activeRows[0]._sharing).toEqual({ shared: true, ownerUsername: 'owner' });
  });

  it('removes permanently deleted rows from the recycle bin only', () => {
    expect(removeDeletedRows([row('a'), row('b')], ['a']).map(r => r.id)).toEqual(['b']);
  });
});
