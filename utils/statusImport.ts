import { TripStatus } from '../types';

/**
 * Resolves a status value read from an imported spreadsheet cell back to a TripStatus.
 * Accepts either the display label the app exports (e.g. "تم تعيين السائق", looked up
 * via labelMap) or the raw enum value itself (e.g. "Driver Assigned", for a sheet edited
 * by hand), and falls back to 'Planned' for a blank or unrecognized cell — the same
 * default new rows already get elsewhere in the app.
 */
export const resolveImportedStatus = (raw: string, labelMap: Record<TripStatus, string>): TripStatus => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'Planned';

  const byLabel = (Object.entries(labelMap) as [TripStatus, string][]).find(([, label]) => label === trimmed);
  if (byLabel) return byLabel[0];

  if ((Object.keys(labelMap) as string[]).includes(trimmed)) return trimmed as TripStatus;

  return 'Planned';
};
