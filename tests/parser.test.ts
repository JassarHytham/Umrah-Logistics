import { describe, it, expect } from 'vitest';
import {
  getCarType,
  formatDate,
  normalizeCity,
  parseDateTime,
  parseItineraryText,
} from '../utils/parser';

// ─────────────────────────────────────────────
// getCarType
// ─────────────────────────────────────────────
describe('getCarType', () => {
  it('returns سيدان for 1 passenger', () => {
    expect(getCarType('1')).toBe('سيدان');
  });

  it('returns سيدان for 4 passengers (boundary)', () => {
    expect(getCarType('4')).toBe('سيدان');
  });

  it('returns جمس for 5 passengers (lower boundary)', () => {
    expect(getCarType('5')).toBe('جمس');
  });

  it('returns جمس for 6 passengers (upper boundary)', () => {
    expect(getCarType('6')).toBe('جمس');
  });

  it('returns باص for 7 passengers (lower boundary)', () => {
    expect(getCarType('7')).toBe('باص');
  });

  it('returns باص for large group (50 passengers)', () => {
    expect(getCarType('50')).toBe('باص');
  });

  it('returns empty string for non-numeric input', () => {
    expect(getCarType('abc')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(getCarType('')).toBe('');
  });

  it('returns باص for 0 passengers (edge case — 0 falls through to bus)', () => {
    // count=0 is not NaN, not in [1,4], not in [5,6] → returns باص
    // This is a known edge case: 0 passengers still returns باص
    expect(getCarType('0')).toBe('باص');
  });
});

// ─────────────────────────────────────────────
// formatDate
// ─────────────────────────────────────────────
describe('formatDate', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(formatDate('2024-01-15')).toBe('15/01/2024');
  });

  it('converts YYYY/MM/DD to DD/MM/YYYY', () => {
    expect(formatDate('2024/01/15')).toBe('15/01/2024');
  });

  it('preserves DD/MM/YYYY when day > 12', () => {
    expect(formatDate('15/01/2024')).toBe('15/01/2024');
  });

  it('flips MM/DD/YYYY to DD/MM/YYYY when month > 12 position', () => {
    // 01/15/2024 → month candidate 01 <= 12, day candidate 15 > 12 → flip
    expect(formatDate('01/15/2024')).toBe('15/01/2024');
  });

  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDate('')).toBe('');
  });

  it('returns original string when no date pattern matches', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('pads single-digit day and month', () => {
    expect(formatDate('2024-1-5')).toBe('05/01/2024');
  });
});

// ─────────────────────────────────────────────
// normalizeCity
// ─────────────────────────────────────────────
describe('normalizeCity', () => {
  it('maps "مطار الملك عبد العزيز" to "جدة"', () => {
    expect(normalizeCity('مطار الملك عبد العزيز الدولي')).toBe('جدة');
  });

  it('maps "JED" to "جدة"', () => {
    expect(normalizeCity('JED')).toBe('جدة');
  });

  it('maps "Jeddah" to "جدة"', () => {
    expect(normalizeCity('Jeddah')).toBe('جدة');
  });

  it('maps "MED" to "المدينة المنورة"', () => {
    expect(normalizeCity('MED')).toBe('المدينة المنورة');
  });

  it('maps "مطار الأمير محمد" to "المدينة المنورة"', () => {
    expect(normalizeCity('مطار الأمير محمد بن عبد العزيز')).toBe('المدينة المنورة');
  });

  it('maps "Medina" to "المدينة المنورة"', () => {
    expect(normalizeCity('Medina')).toBe('المدينة المنورة');
  });

  it('maps "Makkah" to "مكة المكرمة"', () => {
    expect(normalizeCity('Makkah')).toBe('مكة المكرمة');
  });

  it('maps "Mecca" to "مكة المكرمة"', () => {
    expect(normalizeCity('Mecca')).toBe('مكة المكرمة');
  });

  it('returns city name as-is when not in map', () => {
    expect(normalizeCity('الرياض')).toBe('الرياض');
  });

  it('returns empty string for null', () => {
    expect(normalizeCity(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeCity(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeCity('')).toBe('');
  });
});

// ─────────────────────────────────────────────
// parseDateTime
// ─────────────────────────────────────────────
describe('parseDateTime', () => {
  it('parses DD/MM/YYYY + HH:MM correctly', () => {
    const result = parseDateTime('15/01/2024', '14:30');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(0); // January = 0
    expect(result!.getDate()).toBe(15);
    expect(result!.getHours()).toBe(14);
    expect(result!.getMinutes()).toBe(30);
  });

  it('parses YYYY-MM-DD + HH:MM correctly', () => {
    const result = parseDateTime('2024-03-20', '09:00');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(2); // March = 2
    expect(result!.getDate()).toBe(20);
    expect(result!.getHours()).toBe(9);
  });

  it('defaults to 00:00 when time is empty string', () => {
    const result = parseDateTime('15/01/2024', '');
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
  });

  it('returns null for empty date string', () => {
    expect(parseDateTime('', '10:00')).toBeNull();
  });

  it('returns null for date with no recognized separator', () => {
    expect(parseDateTime('15012024', '10:00')).toBeNull();
  });

  it('returns null for date with wrong part count', () => {
    expect(parseDateTime('15/01', '10:00')).toBeNull();
  });

  it('returns null when year is ambiguous (2-digit year)', () => {
    // Parts: 15/01/24 → p0=15, p1=1, p2=24 → p2 not > 1000, p0 not > 1000 → null
    expect(parseDateTime('15/01/24', '10:00')).toBeNull();
  });

  it('parses YYYY/MM/DD format correctly', () => {
    const result = parseDateTime('2024/06/10', '08:00');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(5); // June = 5
    expect(result!.getDate()).toBe(10);
  });
});

// ─────────────────────────────────────────────
// parseItineraryText
// ─────────────────────────────────────────────
describe('parseItineraryText', () => {
  const groupInfo = { groupNo: 'G001', groupName: 'مجموعة الأولى', count: '4' };

  const sampleItinerary = `
رحلة الوصول
تاريخ الوصول
15/01/2024
وقت الوصول
14:30
رقم الرحلة
SV123
المطار
مطار الملك عبد العزيز

الوجهة (مكة المكرمة)
15/01/2024

الوجهة (المدينة المنورة)
20/01/2024

رحلة المغادرة
تاريخ المغادرة
25/01/2024
وقت المغادرة
10:00
رقم الرحلة
SV456
المطار
مطار الأمير محمد
`;

  it('returns an array of rows', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('creates an arrival row with Column1 = وصول', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival).toBeDefined();
  });

  it('creates a departure row with Column1 = مغادرة', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const departure = rows.find(r => r.Column1 === 'مغادرة');
    expect(departure).toBeDefined();
  });

  it('creates an inter-city row when destinations differ', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    expect(intercity).toBeDefined();
  });

  it('arrival row has correct airport mapped to city', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.from).toBe('جدة');
  });

  it('departure row has airport mapped to city', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const departure = rows.find(r => r.Column1 === 'مغادرة');
    expect(departure?.to).toBe('المدينة المنورة');
  });

  it('all rows carry group info', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.groupNo).toBe(groupInfo.groupNo);
      expect(row.groupName).toBe(groupInfo.groupName);
      expect(row.count).toBe(groupInfo.count);
    }
  });

  it('assigns carType سيدان for count=4', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.carType).toBe('سيدان');
    }
  });

  it('assigns status Planned to all parsed rows', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.status).toBe('Planned');
    }
  });

  it('each row has a unique id', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const ids = rows.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(rows.length);
  });

  it('returns a fallback row for unrecognized text (no Arabic sections)', () => {
    const rows = parseItineraryText('Some random text here that is long enough', groupInfo);
    expect(rows.length).toBe(1);
    expect(rows[0].Column1).toBe('غير محدد');
  });

  it('returns empty array for very short text', () => {
    const rows = parseItineraryText('Hi', groupInfo);
    expect(rows.length).toBe(0);
  });

  it('extracts flight number correctly', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.flight).toBe('SV123');
  });

  it('inter-city row uses default time 10:00', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    expect(intercity?.time).toBe('10:00');
  });

  it('inter-city flight is set to "-"', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    expect(intercity?.flight).toBe('-');
  });

  it('parses correctly with bus-sized group (count=15)', () => {
    const bigGroup = { ...groupInfo, count: '15' };
    const rows = parseItineraryText(sampleItinerary, bigGroup);
    for (const row of rows) {
      expect(row.carType).toBe('باص');
    }
  });

  it('does not create inter-city row when destinations are the same', () => {
    const sameDestItinerary = `
رحلة الوصول
تاريخ الوصول
15/01/2024
وقت الوصول
14:30
رقم الرحلة
SV123
المطار
مطار الملك عبد العزيز

الوجهة (مكة المكرمة)
15/01/2024

الوجهة (مكة المكرمة)
20/01/2024

رحلة المغادرة
تاريخ المغادرة
25/01/2024
وقت المغادرة
10:00
رقم الرحلة
SV456
المطار
مطار الملك عبد العزيز
`;
    const rows = parseItineraryText(sameDestItinerary, groupInfo);
    const intercity = rows.filter(r => r.Column1 === 'بين المدن');
    expect(intercity.length).toBe(0);
  });
});
