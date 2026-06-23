import { LogisticsRow } from '../types';

export const countUniqueGroups = (rows: LogisticsRow[]): number => {
  return new Set(
    rows
      .map(row => String(row.groupNo || '').trim())
      .filter(groupNo => groupNo.length > 0)
  ).size;
};
