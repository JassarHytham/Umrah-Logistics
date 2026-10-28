import { describe, expect, it } from 'vitest';
import type { LogisticsRow } from '../types';
import { parseItineraryText } from '../utils/parser';
import { parseItineraryTextEN } from '../utils/parserEN';
import { buildTripMessage, resolveMovementKind, type MovementKind } from '../utils/tripMessage';

const groupInfo = { groupNo: 'G-1', groupName: 'Test Umrah group', count: '4', agency: 'Test agency' };
const alertSettings = {
  arrivalMinutes: 120,
  departureMinutes: 60,
  messageFields: { flight: true, carType: true, count: false, tafweej: false },
};

const englishTemplateHeadlines: Record<MovementKind, string> = {
  arrival: '_*حركة وصول*_ ✈️ 🟢',
  departure: '_*حركة مغادرة نهائية*_ ✈️ ⭕',
  intercity: '_*حركة تنقل بين المدن*_ 🚌 🔄',
  enrichment: '_*برنامج زيارة إثرائية*_ 🕌 ✨',
};

const row = (Column1: string): LogisticsRow => ({
  id: Column1,
  ...groupInfo,
  Column1,
  date: '05/11/2026',
  time: '08:10',
  flight: 'SV-0591',
  from: 'Dubai',
  to: 'Makkah',
  carType: 'Sedan',
  tafweej: '',
  status: 'Planned',
});

const englishFixture = `Trip Information
Note: The program must be at least one day or more
(05/11/2026) Arrival Journey
Travel Method
Arrival Date
2026-11-05
Transport Method
Air Transport Sea Transport Land Transport
Coming From
United Arab Emirates, Dubai
Going to
Saudi Arabia, Jeddah
Flight Number
SV-0591
Airport
King Abdul Aziz International Airport
Airlines
SAUDI ARABIAN AIRLINES
Terminal
TERMINAL 1
Arrival Time
08:10
Type of Trip
Scheduled Flight
Browse Journeys
Destination (Makkah) (2026-11-05 - 2026-11-07)
Hotels
License Name
Signboard Name (Trade Name)
Entrance Date
Exit Date
Duration Of Stay
Room Capacity
Price
Movenpick Hajar Tower Makkah
Movenpick Hotel Hajar Tower
11/05/2026
11/07/2026
2
2
710 SAR
Service
Service Type
Visit Date
Time
Guide
Price
Kaaba Kiswa Exhibition
Enrichment Destinations
2026-11-07
07:20:00
20 SAR
Mount Thawr
Historical Sites
2026-11-06
11:21:00
20 SAR
Details
Price
MAZARAT
15 SAR
Add trip station
(08/11/2026) Departure Journey
Travel Method
Departure Date
2026-11-08
Transport Method
Air Transport Sea Transport Land Transport
leaving from
Saudi Arabia, Jeddah
Going to
Kenya, Nairobi
Flight Number
SV-0435
Airport
King Abdul Aziz International Airport
Airlines
SAUDI ARABIAN AIRLINES
Terminal
TERMINAL 1
Departure Time
01:30
Type of Trip
Scheduled Flight
Browse Journeys
Back Next
Trip Information Summary
Trip Route
Arrival Date (Air Transport)
5-11-2026
Trip Stations
Makkah
Departure Date (Air Transport)
8-11-2026`;

// This is the existing Arabic parser.test.ts golden sample itinerary, which
// has the same arrival, Makkah-to-Madinah transfer, and departure structure.
const arabicParityFixture = `
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

const englishParityFixture = `Arrival Journey
Arrival Date
2024-01-15
Arrival Time
14:30
Flight Number
SV123
Airport
King Abdul Aziz International Airport
Destination (Makkah)
2024-01-15
Destination (Madinah)
2024-01-20
Departure Journey
Departure Date
2024-01-25
Departure Time
10:00
Flight Number
SV456
Airport
Prince Mohammad International Airport`;

describe('movement template selection', () => {
  it('resolves each English movement to its existing template for the supplied trip', () => {
    const rows = parseItineraryTextEN(englishFixture, groupInfo);
    const kinds = rows.map(item => resolveMovementKind(item.Column1));

    expect(kinds).toEqual(['arrival', 'enrichment', 'enrichment', 'departure']);
    for (const item of rows) {
      const kind = resolveMovementKind(item.Column1);
      expect(buildTripMessage(item, 'Test company', alertSettings).split('\n')[0]).toBe(englishTemplateHeadlines[kind]);
    }
    expect(kinds).not.toContain('intercity');
  });

  it('produces matching movement types and templates for English and the existing Arabic fixture', () => {
    const englishRows = parseItineraryTextEN(englishParityFixture, groupInfo);
    const arabicRows = parseItineraryText(arabicParityFixture, groupInfo);
    const englishSequence = englishRows.map(item => ({
      kind: resolveMovementKind(item.Column1),
      headline: buildTripMessage(item, 'Test company', alertSettings).split('\n')[0],
    }));
    const arabicSequence = arabicRows.map(item => ({
      kind: resolveMovementKind(item.Column1),
      headline: buildTripMessage(item, 'Test company', alertSettings).split('\n')[0],
    }));

    expect(englishSequence).toEqual(arabicSequence);
    expect(englishSequence.map(item => item.kind)).toEqual(['arrival', 'intercity', 'departure']);
  });

  it('does not silently assign unknown movements to the inter-city template', () => {
    expect(() => resolveMovementKind('Unexpected movement marker')).toThrow(/Unknown movement type.*Unexpected movement marker/);
  });

  it('normalizes English case and whitespace while retaining sea and land journey movement types', () => {
    expect(resolveMovementKind('  aRRival   ')).toBe('arrival');
    expect(resolveMovementKind('DEPARTURE')).toBe('departure');
    expect(resolveMovementKind('Between   Cities')).toBe('intercity');
    expect(resolveMovementKind('Enrichment   Service')).toBe('enrichment');
    // Arrival and departure labels are independent of the transport mode.
    for (const transport of ['Sea Transport', 'Land Transport']) {
      expect(resolveMovementKind(`Arrival (${transport})`)).toBe('arrival');
      expect(resolveMovementKind(`Departure (${transport})`)).toBe('departure');
    }
  });

  it('keeps each known Arabic movement on its original template', () => {
    const knownArabicRows = ['وصول', 'مغادرة', 'بين المدن', 'الخدمات الإثرائية'].map(row);
    expect(knownArabicRows.map(item => buildTripMessage(item, 'الشركة', alertSettings).split('\n')[0])).toEqual([
      '_*حركة وصول*_ ✈️ 🟢',
      '_*حركة مغادرة نهائية*_ ✈️ ⭕',
      '_*حركة تنقل بين المدن*_ 🚌 🔄',
      '_*برنامج زيارة إثرائية*_ 🕌 ✨',
    ]);
  });
});
