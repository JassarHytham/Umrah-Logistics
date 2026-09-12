import { LogisticsRow } from '../types';

/** Every group number counts once as a group, no matter how many rows (legs) share it. */
export const countUniqueGroups = (rows: LogisticsRow[]): number => {
  return new Set(
    rows
      .map(row => String(row.groupNo || '').trim())
      .filter(groupNo => groupNo.length > 0)
  ).size;
};

/**
 * Parses the app's stored date format (DD/MM/YYYY, see utils/date.ts) into a real Date.
 * Returns null for anything that doesn't match — callers must treat that as "unknown", not "past".
 */
export const parseDDMMYYYY = (dateStr: string): Date | null => {
  const trimmed = String(dateStr || '').trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

/**
 * Chronological (not lexicographic) date comparisons. DD/MM/YYYY strings sort wrong as plain
 * text (e.g. "05/10/2026" < "12/09/2026"), so every date comparison must go through here.
 */
export const isDateOnOrAfter = (dateStr: string, referenceStr: string): boolean => {
  const date = parseDDMMYYYY(dateStr);
  const reference = parseDDMMYYYY(referenceStr);
  if (!date || !reference) return false;
  return date.getTime() >= reference.getTime();
};

export const isDateBefore = (dateStr: string, referenceStr: string): boolean => {
  const date = parseDDMMYYYY(dateStr);
  const reference = parseDDMMYYYY(referenceStr);
  if (!date || !reference) return false;
  return date.getTime() < reference.getTime();
};

/** Known spelling variants seen in real data, folded into one canonical city name for aggregation. */
const CITY_ALIASES: Record<string, string> = {
  'مكة': 'مكة المكرمة',
  'مدينة': 'المدينة المنورة',
  'المدينة': 'المدينة المنورة',
};

/** Normalizes a city name for grouping/charting only — never mutates stored row data. */
export const normalizeCityName = (raw: string): string => {
  const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return CITY_ALIASES[trimmed] || trimmed;
};

export interface GroupedCount {
  label: string;
  count: number;
  /** The exact raw field values folded into this label — pass these back to TableEditor's externalFilters. */
  rawValues: string[];
}

/**
 * Groups rows by a field, optionally normalizing values first (e.g. city name aliasing).
 * Keeps track of the raw values behind each group so a click can build an exact-match filter.
 */
export const buildNormalizedDistribution = (
  rows: LogisticsRow[],
  field: keyof LogisticsRow,
  normalizeFn: (raw: string) => string = (v) => String(v || '').trim()
): GroupedCount[] => {
  const groups = new Map<string, { count: number; rawValues: Set<string> }>();
  rows.forEach(row => {
    const raw = String(row[field] || '').trim();
    if (!raw) return;
    const label = normalizeFn(raw);
    if (!label) return;
    const g = groups.get(label) || { count: 0, rawValues: new Set<string>() };
    g.count += 1;
    g.rawValues.add(raw);
    groups.set(label, g);
  });
  return Array.from(groups.entries())
    .map(([label, g]) => ({ label, count: g.count, rawValues: Array.from(g.rawValues) }))
    .sort((a, b) => b.count - a.count);
};

export interface RouteCount {
  from: string;
  to: string;
  count: number;
  fromRaw: string[];
  toRaw: string[];
}

/** Top from→to routes, with city names normalized so spelling variants don't fragment the ranking. */
export const buildTopRoutes = (rows: LogisticsRow[], limit = 5): RouteCount[] => {
  const groups = new Map<string, { from: string; to: string; count: number; fromRaw: Set<string>; toRaw: Set<string> }>();
  rows.forEach(row => {
    const rawFrom = String(row.from || '').trim();
    const rawTo = String(row.to || '').trim();
    if (!rawFrom || !rawTo) return;
    const from = normalizeCityName(rawFrom);
    const to = normalizeCityName(rawTo);
    if (!from || !to) return;
    const key = `${from}→${to}`;
    const g = groups.get(key) || { from, to, count: 0, fromRaw: new Set<string>(), toRaw: new Set<string>() };
    g.count += 1;
    g.fromRaw.add(rawFrom);
    g.toRaw.add(rawTo);
    groups.set(key, g);
  });
  return Array.from(groups.values())
    .map(g => ({ from: g.from, to: g.to, count: g.count, fromRaw: Array.from(g.fromRaw), toRaw: Array.from(g.toRaw) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};
