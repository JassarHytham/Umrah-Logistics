import { LogisticsRow } from '../types';

type RowState = {
  activeRows: LogisticsRow[];
  deletedRows: LogisticsRow[];
};

const clearDeletedMetadata = (row: LogisticsRow): LogisticsRow => {
  if (!row._sharing) return row;
  const { deletedAt, deletedByUsername, ...sharing } = row._sharing;
  return { ...row, _sharing: sharing };
};

const withDeletedMetadata = (row: LogisticsRow, username?: string): LogisticsRow => {
  const sharing = row._sharing || { shared: false };
  return {
    ...row,
    _sharing: {
      ...sharing,
      deletedByUsername: username,
      deletedAt: new Date().toISOString(),
    },
  };
};

export const markRowsDeleted = (
  activeRows: LogisticsRow[],
  deletedRows: LogisticsRow[],
  ids: Iterable<string>,
  username?: string,
): RowState => {
  const idSet = new Set(Array.from(ids));
  const movingRows = activeRows.filter(row => idSet.has(row.id)).map(row => withDeletedMetadata(row, username));

  return {
    activeRows: activeRows.filter(row => !idSet.has(row.id)),
    deletedRows: [...movingRows, ...deletedRows.filter(row => !idSet.has(row.id))],
  };
};

export const restoreRows = (
  activeRows: LogisticsRow[],
  deletedRows: LogisticsRow[],
  ids: Iterable<string>,
): RowState => {
  const idSet = new Set(Array.from(ids));
  const restoredRows = deletedRows.filter(row => idSet.has(row.id)).map(clearDeletedMetadata);

  return {
    activeRows: [...restoredRows, ...activeRows.filter(row => !idSet.has(row.id))],
    deletedRows: deletedRows.filter(row => !idSet.has(row.id)),
  };
};

export const removeDeletedRows = (
  deletedRows: LogisticsRow[],
  ids: Iterable<string>,
): LogisticsRow[] => {
  const idSet = new Set(Array.from(ids));
  return deletedRows.filter(row => !idSet.has(row.id));
};

export const isPersistedRow = (row: LogisticsRow): boolean => row._version !== undefined;
