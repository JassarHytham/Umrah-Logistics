import type { LogisticsRow } from '../types';
import { parseDateTime } from './parser';

export interface SimpleTripStay {
  city: 'mecca' | 'madina';
  hotel: string;
  entryDate: string;
  leavingDate: string;
  durationDays: string;
}

export interface SimpleTripSummary {
  groupNo: string;
  groupName: string;
  agency: string;
  status: string;
  entryDate: string;
  leavingDate: string;
  meccaHotel: string;
  meccaDuration: string;
  madinaHotel: string;
  madinaDuration: string;
  itinerary: LogisticsRow[];
}

const ENRICHMENT_TYPE = 'الخدمات الإثرائية';
const INTERCITY_TYPE = 'بين المدن';
const DEPARTURE_TYPE = 'مغادرة';

const MECCA_MARKERS = ['مكة المكرمة', 'مكة', 'مكه'];
const MADINA_MARKERS = ['المدينة المنورة', 'المدينة', 'مدينة'];

const includesAny = (value: string, markers: string[]) =>
  markers.some(marker => value.includes(marker));

const normalize = (value: unknown) => String(value ?? '').trim();

const detectCity = (value: unknown): 'mecca' | 'madina' | null => {
  const text = normalize(value);
  if (!text) return null;
  if (includesAny(text, MECCA_MARKERS)) return 'mecca';
  if (includesAny(text, MADINA_MARKERS)) return 'madina';
  return null;
};

const isEnrichmentRow = (row: LogisticsRow) => row.Column1 === ENRICHMENT_TYPE;

const isHotelLike = (value: string) => value.includes('فندق') || /\(.+\)/.test(value);

const sortRows = (rows: LogisticsRow[]) =>
  [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftDate = parseDateTime(normalize(left.row.date), normalize(left.row.time) || '00:00');
      const rightDate = parseDateTime(normalize(right.row.date), normalize(right.row.time) || '00:00');

      if (leftDate && rightDate) {
        const delta = leftDate.getTime() - rightDate.getTime();
        if (delta !== 0) return delta;
      } else if (leftDate) {
        return -1;
      } else if (rightDate) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ row }) => row);

const formatDateOnly = (date: Date | null) => {
  if (!date) return null;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const dayDiff = (start: string, end: string) => {
  const startDate = parseDateTime(start, '00:00');
  const endDate = parseDateTime(end, '00:00');
  if (!startDate || !endDate) return '-';

  const msPerDay = 1000 * 60 * 60 * 24;
  return String(Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / msPerDay)));
};

const getHotelForCity = (row: LogisticsRow, city: 'mecca' | 'madina') => {
  const to = normalize(row.to);
  const from = normalize(row.from);

  if (detectCity(to) === city && isHotelLike(to)) return to;
  if (detectCity(from) === city && isHotelLike(from)) return from;
  if (detectCity(to) === city) return to || '-';
  if (detectCity(from) === city) return from || '-';
  return '-';
};

const buildStay = (rows: LogisticsRow[], city: 'mecca' | 'madina'): SimpleTripStay => {
  const relevantRows = rows.filter(row => !isEnrichmentRow(row));
  const entryIndex = relevantRows.findIndex(row => detectCity(row.to) === city);

  if (entryIndex < 0) {
    return {
      city,
      hotel: '-',
      entryDate: '-',
      leavingDate: '-',
      durationDays: '-',
    };
  }

  const entryRow = relevantRows[entryIndex];
  const hotel = getHotelForCity(entryRow, city);
  const entryDate = normalize(entryRow.date) || '-';
  const lastKnownDate = normalize(relevantRows[relevantRows.length - 1]?.date) || '-';

  let leavingDate = lastKnownDate;
  for (let index = entryIndex + 1; index < relevantRows.length; index += 1) {
    const row = relevantRows[index];
    const fromCity = detectCity(row.from);

    if (fromCity !== city) continue;
    if (row.Column1 === INTERCITY_TYPE || row.Column1 === DEPARTURE_TYPE) {
      leavingDate = normalize(row.date) || leavingDate;
      break;
    }
  }

  return {
    city,
    hotel,
    entryDate,
    leavingDate,
    durationDays: entryDate !== '-' && leavingDate !== '-' ? dayDiff(entryDate, leavingDate) : '-',
  };
};

const pickSummaryStatus = (rows: LogisticsRow[]) =>
  [...rows].reverse().find(row => normalize(row.status))?.status ?? 'Planned';

export function buildSimpleTripSummaries(rows: LogisticsRow[]): SimpleTripSummary[] {
  const groups = new Map<string, LogisticsRow[]>();

  for (const row of rows) {
    const key = normalize(row.groupNo) || row.id;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  return Array.from(groups.entries())
    .map(([groupNo, groupRows]) => {
      const itinerary = sortRows(groupRows);
      const datedRows = itinerary
        .map(row => ({
          row,
          date: parseDateTime(normalize(row.date), normalize(row.time) || '00:00'),
        }))
        .filter(item => item.date);

      const entryDate = formatDateOnly(datedRows[0]?.date ?? null) ?? normalize(itinerary[0]?.date) ?? '-';
      const leavingDate =
        formatDateOnly(datedRows[datedRows.length - 1]?.date ?? null) ??
        normalize(itinerary[itinerary.length - 1]?.date) ??
        '-';

      const mecca = buildStay(itinerary, 'mecca');
      const madina = buildStay(itinerary, 'madina');

      return {
        groupNo,
        groupName: normalize(itinerary[0]?.groupName) || '-',
        agency: normalize(itinerary[0]?.agency) || '-',
        status: String(pickSummaryStatus(itinerary) || 'Planned'),
        entryDate,
        leavingDate,
        meccaHotel: mecca.hotel,
        meccaDuration: mecca.durationDays,
        madinaHotel: madina.hotel,
        madinaDuration: madina.durationDays,
        itinerary,
      };
    })
    .sort((left, right) => {
      const leftDate = parseDateTime(left.entryDate, '00:00');
      const rightDate = parseDateTime(right.entryDate, '00:00');

      if (leftDate && rightDate) return leftDate.getTime() - rightDate.getTime();
      if (leftDate) return -1;
      if (rightDate) return 1;
      return left.groupNo.localeCompare(right.groupNo, 'ar', { numeric: true });
    });
}
