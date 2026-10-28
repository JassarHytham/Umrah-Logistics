import { LogisticsRow, AlertSettings } from '../types';

const ENRICHMENT_TYPES = ['الخدمات الإثرائية', 'Enrichment Service'];

export type MovementKind = 'arrival' | 'departure' | 'intercity' | 'enrichment';

export const resolveMovementKind = (movementMarker: unknown): MovementKind => {
  const col1 = String(movementMarker ?? '').normalize('NFC').trim();
  const englishMarker = col1.replace(/\s+/g, ' ').toLocaleLowerCase('en');

  if (ENRICHMENT_TYPES.includes(col1)) return 'enrichment';
  if (col1.includes('وصول')) return 'arrival';
  if (col1.includes('مغادرة')) return 'departure';
  if (col1 === 'بين المدن') return 'intercity';

  if (/^arrival(?: journey)?(?:\s*[([]\s*(?:sea|land) transport\s*[)\]])?$/.test(englishMarker)) return 'arrival';
  if (/^departure(?: journey)?(?:\s*[([]\s*(?:sea|land) transport\s*[)\]])?$/.test(englishMarker)) return 'departure';

  switch (englishMarker) {
    case 'arrival': return 'arrival';
    case 'departure': return 'departure';
    case 'between cities': return 'intercity';
    case 'enrichment service':
    case 'enrichment services': return 'enrichment';
    default:
      throw new Error(`Unknown movement type: ${JSON.stringify(String(movementMarker ?? ''))}`);
  }
};

/** Subtracts minutes from an "HH:MM" time string, wrapping within the same day. Returns '' if the time doesn't parse. */
const subtractMinutes = (time: string, minutes: number): string => {
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const total = Number(match[1]) * 60 + Number(match[2]) - minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return `${h}:${m}`;
};

const v = (val: string | undefined) => String(val || '').trim();

/**
 * Formats a WhatsApp-ready Arabic movement message for a trip row, adapted per movement type
 * (arrival / departure / inter-city / enrichment service). Field mapping follows how parser.ts
 * already populates rows for each type (e.g. departure: from=hotel, to=airport).
 */
export const buildTripMessage = (row: LogisticsRow, companyName: string, alertSettings: AlertSettings): string => {
  const kind = resolveMovementKind(row.Column1);
  const date = v(row.date);
  const agency = v(row.agency);
  const count = v(row.count);
  const time = v(row.time);
  const flight = v(row.flight);
  const carType = v(row.carType);
  const from = v(row.from);
  const to = v(row.to);
  const visasLine = `* *تأشيرات ${companyName || ''}*`;

  if (kind === 'arrival') {
    const pickupTime = time ? subtractMinutes(time, alertSettings.arrivalMinutes) : '';
    return [
      `_*حركة وصول*_ ✈️ 🟢`,
      visasLine,
      `*تاريخ الحركة* : ${date}`,
      `*الوكيل* : ${agency}`,
      `*العدد* : ${count}`,
      `*وقت الاستقبال* : ${pickupTime}`,
      `*الفندق* : ${to}`,
      `*المسار* : - ${from} - ${to}`,
      `*وقت الهبوط* : ${time}`,
      `*الخطوط -*: ${flight}`,
    ].join('\n');
  }

  if (kind === 'departure') {
    const pickupTime = time ? subtractMinutes(time, alertSettings.departureMinutes) : '';
    return [
      `_*حركة مغادرة نهائية*_ ✈️ ⭕`,
      visasLine,
      `*تاريخ الحركة* : ${date}`,
      `*الوكيل* : ${agency}`,
      `*العدد* : ${count}`,
      `*وقت التحرك* : ${pickupTime}`,
      `*الفندق* : ${from}`,
      `*المسار* : - ${from} - ${to}`,
      `*وقت الإقلاع* : ${time}`,
      `*الخطوط -*: ${flight}`,
    ].join('\n');
  }

  if (kind === 'enrichment') {
    return [
      `_*برنامج زيارة إثرائية*_ 🕌 ✨`,
      visasLine,
      `*تاريخ الحركة* : ${date}`,
      `*الوكيل* : ${agency}`,
      `*العدد* : ${count}`,
      `*وقت التحرك* : ${time}`,
      `*من* : ${from}`,
      `*الوجهة* : ${to}`,
      `*السيارة -*: ${carType}`,
    ].join('\n');
  }

  // Inter-city ground transfer — no flight, uses the wider of the two alert buffers
  // (same convention App.tsx already uses for proximity alerts on non-arrival/departure rows).
  const buffer = Math.max(alertSettings.arrivalMinutes, alertSettings.departureMinutes);
  const pickupTime = time ? subtractMinutes(time, buffer) : '';
  return [
    `_*حركة تنقل بين المدن*_ 🚌 🔄`,
    visasLine,
    `*تاريخ الحركة* : ${date}`,
    `*الوكيل* : ${agency}`,
    `*العدد* : ${count}`,
    `*وقت التحرك* : ${pickupTime}`,
    `*المسار* : - ${from} - ${to}`,
    `*وقت الوصول المتوقع* : ${time}`,
    `*السيارة -*: ${carType}`,
  ].join('\n');
};
