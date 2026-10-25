const OPERATIONAL_FIELDS = new Set(['status', 'notes']);
const SYSTEM_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at', 'deleted_by_user_id', 'version',
  '_sharing', '_originalIndex', '_version', '_workspaceId', 'workspaceId', 'workspace_id',
  'source', 'sourceId', 'ingestId', 'batchId', 'batch_id', '_allowDuplicate',
].map((field) => field.toLowerCase()));

const arabicDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, (digit) => {
  const code = digit.charCodeAt(0);
  return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
});

export const normalizeTripValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return arabicDigits(String(value))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const normalizeDate = (value: unknown): string => {
  const normalized = normalizeTripValue(value);
  let match = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;

  match = normalized.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) return normalized;
  let first = Number(match[1]);
  let second = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  // The app's imported and parsed dates use day/month/year. Recognize the
  // unambiguous US month/day variant when only the first component can be a month.
  if (first <= 12 && second > 12) [first, second] = [second, first];
  if (first > 31 || second > 12 || first < 1 || second < 1) return normalized;
  return `${String(year).padStart(4, '0')}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
};

const normalizeTime = (value: unknown): string => {
  const normalized = normalizeTripValue(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return normalized;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (match[4]) {
    if (hour < 1 || hour > 12) return normalized;
    hour = (hour % 12) + (match[4] === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return normalized;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
};

const isExcludedField = (key: string) => {
  const normalized = key.toLowerCase();
  const compact = normalized.replace(/_/g, '');
  return SYSTEM_FIELDS.has(normalized) || OPERATIONAL_FIELDS.has(normalized) ||
    /^(?:_?source)(?:_?(?:id|name|type|batch|ingest))?$/.test(normalized) ||
    /^_?ingest(?:_?(?:id|uuid|key|batch(?:_?id)?|at|source))?$/.test(normalized) ||
    /^_?batch(?:_?(?:id|uuid|key|at|source))?$/.test(normalized) ||
    /^_/.test(key) || /^(?:created|updated|deleted)at$/.test(compact);
};

const normalizeValueForField = (key: string, value: unknown): unknown => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return '';
  if (/date/i.test(key)) return normalizeDate(value);
  if (/time/i.test(key)) return normalizeTime(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return normalizeTripValue(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValueForField('', item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((childKey) => [
      childKey,
      normalizeValueForField(childKey, (value as Record<string, unknown>)[childKey]),
    ]));
  }
  return value;
};

export const normalizeTripForComparison = (trip: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(trip).filter((key) => !isExcludedField(key)).sort().map((key) => [
    key,
    normalizeValueForField(key, trip[key]),
  ]));

export const areTripsEquivalent = (left: Record<string, unknown>, right: Record<string, unknown>) => {
  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]))
    .filter((key) => !isExcludedField(key))
    .sort();
  const normalize = (trip: Record<string, unknown>) => Object.fromEntries(keys.map((key) => [
    key,
    normalizeValueForField(key, trip[key]),
  ]));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
};
