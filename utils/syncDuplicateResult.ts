type SkippedTripDuplicate = { clientId: string; existingId: string };
export const DUPLICATE_TRIP_NOTIFICATION = 'Trip already exists, duplicate not added';

export const applySkippedTripDuplicates = <T extends { id: string }>(
  rows: T[],
  skipped: SkippedTripDuplicate[],
  processedIds?: Set<string>,
) => {
  const skippedIds = new Set(skipped.map(({ clientId }) => clientId));
  return {
    rows: rows.filter((row) => !skippedIds.has(row.id)).map((row) => {
      const candidate = row as T & { _allowDuplicate?: string };
      if (!candidate._allowDuplicate || (processedIds && !processedIds.has(row.id))) return row;
      const { _allowDuplicate: _ignored, ...savedRow } = candidate;
      return savedRow as T;
    }),
    skippedCount: skipped.length,
    notification: skipped.length ? DUPLICATE_TRIP_NOTIFICATION : undefined,
  };
};
