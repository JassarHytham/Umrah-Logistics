export type SyncArea = 'trips' | 'settings';

const statusOf = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number(error.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
};

export const formatSyncError = (area: SyncArea, error: unknown): string => {
  const label = area === 'trips' ? 'الرحلات' : 'الإعدادات';
  const status = statusOf(error);
  if (status === 413) return `فشل مزامنة ${label} (HTTP 413): حجم الطلب أكبر من الحد المسموح.`;
  const detail = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160) : '';
  if (status) return `فشل مزامنة ${label} (HTTP ${status}): ${detail || 'رفض الخادم الطلب'}`;
  return `فشل مزامنة ${label}: تعذر الاتصال بالخادم${detail ? ` (${detail})` : ''}.`;
};

export const summarizeSyncResults = (
  [rows, settings]: [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>],
): { needsReload: boolean; messages: string[] } => {
  const rowConflict = rows.status === 'rejected' && statusOf(rows.reason) === 409;
  const partialSync = rows.status === 'rejected' && Boolean(rows.reason && typeof rows.reason === 'object' && rows.reason.partialSync === true);
  const needsReload = rowConflict || partialSync;
  const messages: string[] = [];
  if (rows.status === 'rejected' && !rowConflict) messages.push(formatSyncError('trips', rows.reason));
  if (settings.status === 'rejected') messages.push(formatSyncError('settings', settings.reason));
  return { needsReload, messages };
};
