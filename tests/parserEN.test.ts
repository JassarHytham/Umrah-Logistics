import { describe, it, expect } from 'vitest';
import {
  getCarTypeEN,
  normalizeCityEN,
  parseItineraryTextEN,
} from '../utils/parserEN';

// ─────────────────────────────────────────────
// getCarTypeEN
// ─────────────────────────────────────────────
describe('getCarTypeEN', () => {
  it('returns Sedan for 1 passenger', () => {
    expect(getCarTypeEN('1')).toBe('Sedan');
  });

  it('returns Sedan for 4 passengers (boundary)', () => {
    expect(getCarTypeEN('4')).toBe('Sedan');
  });

  it('returns GMC for 5 passengers (lower boundary)', () => {
    expect(getCarTypeEN('5')).toBe('GMC');
  });

  it('returns GMC for 6 passengers (upper boundary)', () => {
    expect(getCarTypeEN('6')).toBe('GMC');
  });

  it('returns Bus for 7 passengers (lower boundary)', () => {
    expect(getCarTypeEN('7')).toBe('Bus');
  });

  it('returns Bus for large group (50 passengers)', () => {
    expect(getCarTypeEN('50')).toBe('Bus');
  });

  it('returns empty string for non-numeric input', () => {
    expect(getCarTypeEN('abc')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(getCarTypeEN('')).toBe('');
  });
});

// ─────────────────────────────────────────────
// normalizeCityEN
// ─────────────────────────────────────────────
describe('normalizeCityEN', () => {
  it('maps "King Abdul Aziz International Airport" to "Jeddah"', () => {
    expect(normalizeCityEN('King Abdul Aziz International Airport')).toBe('Jeddah');
  });

  it('maps "JED" to "Jeddah"', () => {
    expect(normalizeCityEN('JED')).toBe('Jeddah');
  });

  it('maps "Jeddah" to "Jeddah"', () => {
    expect(normalizeCityEN('Jeddah')).toBe('Jeddah');
  });

  it('maps "MED" to "Madinah"', () => {
    expect(normalizeCityEN('MED')).toBe('Madinah');
  });

  it('maps "Prince Mohammad International Airport" to "Madinah"', () => {
    expect(normalizeCityEN('Prince Mohammad International Airport')).toBe('Madinah');
  });

  it('maps "Medina" to "Madinah"', () => {
    expect(normalizeCityEN('Medina')).toBe('Madinah');
  });

  it('maps "Makkah" to "Makkah"', () => {
    expect(normalizeCityEN('Makkah')).toBe('Makkah');
  });

  it('maps "Mecca" to "Makkah"', () => {
    expect(normalizeCityEN('Mecca')).toBe('Makkah');
  });

  it('returns city name as-is when not in map', () => {
    expect(normalizeCityEN('Riyadh')).toBe('Riyadh');
  });

  it('returns empty string for null', () => {
    expect(normalizeCityEN(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeCityEN(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeCityEN('')).toBe('');
  });
});

// ─────────────────────────────────────────────
// parseItineraryTextEN — golden path (real provided sample)
// ─────────────────────────────────────────────
describe('parseItineraryTextEN', () => {
  const groupInfo = { groupNo: 'G001', groupName: 'First Group', count: '4' };

  // Structurally mirrors the real English-mode capture from the design spec
  // (docs/superpowers/specs/2026-07-25-english-parser-design.md), single
  // destination, air-transport-only, with hotel + enrichment + additional
  // services.
  const sampleItinerary = `
Arrival Journey
Arrival Date
2026-08-24
Arrival Time
17:15
Flight Number
3T-0204
Airport
King Abdul Aziz International Airport
Airlines
TARCO AIR
Terminal
NORTH TERMINAL
Type of Trip
Scheduled Flight
Browse Journeys

Destination (Makkah)
(2026-08-24 - 2026-08-26)
Hotels
Hotel / Host Name    Entrance Date    Exit Date    Duration Of Stay    Room Capacity    Price
Sama Al Bait Hotel    08/24/2026    08/26/2026    2    10    510 SAR
Enrichment Services
Service    Service Type    Visit Date    Time    Guide    Price
Mount An-Nur and Hira Cave    Historical Sites    2026-08-25    08:13:00    HAYTHAM    15 SAR
Additional Services
Details    Price
MAZRAT    20 SAR

Add trip station

Departure Journey
Departure Date
2026-08-27
Departure Time
09:30
Flight Number
3T-0205
Airport
King Abdul Aziz International Airport
Airlines
TARCO AIR
Terminal
NORTH TERMINAL

Trip Information Summary
Trip Route
Arrival Date (Air Transport)
24-8-2026
Trip Stations
Makkah
Departure Date (Air Transport)
27-8-2026
`;

  it('returns an array of rows', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('creates an arrival row with Column1 = Arrival', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'Arrival');
    expect(arrival).toBeDefined();
  });

  it('arrival row has correct date, time, flight, and airport mapped to city', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'Arrival');
    expect(arrival?.date).toBe('24/08/2026');
    expect(arrival?.time).toBe('17:15');
    expect(arrival?.flight).toBe('3T-0204');
    expect(arrival?.from).toBe('King Abdul Aziz International Airport (Jeddah)');
  });

  it('arrival row destination is the hotel at the destination city', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'Arrival');
    expect(arrival?.to).toBe('Sama Al Bait Hotel (Makkah)');
  });

  it('creates a departure row with Column1 = Departure', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const departure = rows.find(r => r.Column1 === 'Departure');
    expect(departure).toBeDefined();
    expect(departure?.date).toBe('27/08/2026');
    expect(departure?.time).toBe('09:30');
    expect(departure?.flight).toBe('3T-0205');
    expect(departure?.from).toBe('Sama Al Bait Hotel (Makkah)');
    expect(departure?.to).toBe('King Abdul Aziz International Airport (Jeddah)');
  });

  it('creates an enrichment service row for the destination', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const service = rows.find(r => r.to === 'Mount An-Nur and Hira Cave');
    expect(service).toBeDefined();
    expect(service?.from).toBe('Sama Al Bait Hotel (Makkah)');
    expect(service?.date).toBe('25/08/2026');
    expect(service?.time).toBe('08:13:00');
  });

  it('all rows carry group info', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.groupNo).toBe(groupInfo.groupNo);
      expect(row.groupName).toBe(groupInfo.groupName);
      expect(row.count).toBe(groupInfo.count);
    }
  });

  it('all rows carry agency when provided in group info', () => {
    const rows = parseItineraryTextEN(sampleItinerary, { ...groupInfo, agency: 'Amira Travel' });
    for (const row of rows) {
      expect(row.agency).toBe('Amira Travel');
    }
  });

  it('defaults agency to empty string when group info omits it', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.agency).toBe('');
    }
  });

  it('assigns carType Sedan for count=4', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.carType).toBe('Sedan');
    }
  });

  it('assigns status Planned to all parsed rows', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.status).toBe('Planned');
    }
  });

  it('each row has a unique id', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const ids = rows.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(rows.length);
  });

  it('extracts alphanumeric flight codes that start with a digit (e.g. 3T)', () => {
    const rows = parseItineraryTextEN(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'Arrival');
    expect(arrival?.flight).toBe('3T-0204');
  });

  it('returns a fallback row for unrecognized text (no English itinerary labels)', () => {
    const rows = parseItineraryTextEN('Some random text here that is long enough', groupInfo);
    expect(rows.length).toBe(1);
    expect(rows[0].Column1).toBe('Unspecified');
  });

  it('returns empty array for very short text', () => {
    const rows = parseItineraryTextEN('Hi', groupInfo);
    expect(rows.length).toBe(0);
  });

  it('creates an inter-city row when destinations differ', () => {
    const multiDestItinerary = `
Arrival Journey
Arrival Date
2026-07-03
Flight Number
EK-0807
Airport
Prince Mohammed Bin Abdulaziz Airport
Arrival Time
03:00

Destination (Madinah)
(2026-07-03 - 2026-07-06)
Hotels
Hotel / Host Name    Entrance Date    Exit Date    Duration Of Stay    Room Capacity    Price
Madinah Hilton Hotel    07/03/2026    07/06/2026    3    4    1410 SAR

Destination (Makkah)
(2026-07-06 - 2026-07-10)
Hotels
Hotel / Host Name    Entrance Date    Exit Date    Duration Of Stay    Room Capacity    Price
Dar Al Tawhid Intercontinental Hotel    07/06/2026    07/10/2026    4    4    1410 SAR

Add trip station

Departure Journey
Departure Date
2026-07-11
Flight Number
EK-0802
Airport
King Abdul Aziz International Airport
Departure Time
04:05
`;
    const rows = parseItineraryTextEN(multiDestItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'Between Cities');
    expect(intercity).toBeDefined();
    expect(intercity?.from).toBe('Madinah Hilton Hotel (Madinah)');
    expect(intercity?.to).toBe('Dar Al Tawhid Intercontinental Hotel (Makkah)');
    expect(intercity?.time).toBe('10:00');
  });

  // Real extension capture: the live portal never renders an "Enrichment
  // Services" (or "Additional Services") section title — only the bare
  // column-header row appears directly after the hotel table row.
  it('creates an enrichment service row when no "Enrichment Services" section title is present', () => {
    const realCaptureText = `Trip Information
Note: The program must be at least one day or more
(09/08/2026) Arrival Journey
Travel Method
Arrival Date
2026-08-09
Transport Method
Air Transport Sea Transport Land Transport
Coming From
Egypt, Cairo
Going to
Saudi Arabia, Madina
Flight Number
MS-0675
Airport
Prince Mohammad International Airport
Airlines
EGYPT AIR
Terminal
T1
Arrival Time
01:20
Type of Trip
Scheduled Flight
Browse Journeys
Destination (Makkah) (2026-08-09 - 2026-08-29)
Hotels
Hotel / Host Name
Entrance Date
Exit Date
Duration Of Stay
Room Capacity
Price
iklil aldiyafa Company To operate hotels
08/09/2026
08/29/2026
20
4
410 SAR
Service
Service Type
Visit Date
Time
Guide
Price
Mount An-Nur and Hira Cave
Historical Sites
2026-08-28
08:13:00
HAYTHAM
15 SAR
Details
Price
MAZRAT
20 SAR
Add trip station
(29/08/2026) Departure Journey
Travel Method
Departure Date
2026-08-29
Transport Method
Air Transport Sea Transport Land Transport
leaving from
Saudi Arabia, Madina
Going to
Egypt, Cairo
Flight Number
MS-0676
Airport
Prince Mohammad International Airport
Airlines
EGYPT AIR
Terminal
T1
Departure Time
02:20
Type of Trip
Scheduled Flight
Browse Journeys
Back Next
Trip Information Summary
Trip Route
Arrival Date (Air Transport)
9-8-2026
Trip Stations
Makkah
Departure Date (Air Transport)
29-8-2026`;

    const rows = parseItineraryTextEN(realCaptureText, groupInfo);
    const service = rows.find(r => r.to === 'Mount An-Nur and Hira Cave');
    expect(service).toBeDefined();
    expect(service?.from).toBe('iklil aldiyafa Company To operate hotels (Makkah)');
    expect(service?.date).toBe('28/08/2026');
    expect(service?.time).toBe('08:13:00');
  });

  // Real extension capture: a multi-destination itinerary where a service's
  // "Enrichment Destinations" type label contains the substring "Destination",
  // which previously collided with the destination-block boundary search and
  // truncated the block before the enrichment rows could be parsed.
  it('creates enrichment service rows across multiple destinations when a service type contains "Destination"', () => {
    const realCaptureText = `Trip Information
Note: The program must be at least one day or more
(05/08/2026) Arrival Journey
Travel Method
Arrival Date
2026-08-05
Transport Method
Air Transport Sea Transport Land Transport
Coming From
Egypt, Cairo
Going to
Saudi Arabia, Madina
Flight Number
MS-0677
Airport
Prince Mohammad International Airport
Airlines
EGYPT AIR
Terminal
T1
Arrival Time
19:30
Type of Trip
Scheduled Flight
Browse Journeys
Destination (Madina) (2026-08-05 - 2026-08-10)
Hotels
Hotel / Host Name
Entrance Date
Exit Date
Duration Of Stay
Room Capacity
Price
Odest Hotel
08/05/2026
08/10/2026
5
3
1260 SAR
Service
Service Type
Visit Date
Time
Guide
Price
Quba Avenue
Enrichment Destinations
2026-08-06
08:00:00
30 SAR
Sayyid al-Shuhada' - Uhud Area
Historical Sites
2026-08-08
07:33:00
30 SAR
Details
Price
MAZARAT
30 SAR
Destination (Makkah) (2026-08-10 - 2026-08-15)
Hotels
Hotel / Host Name
Entrance Date
Exit Date
Duration Of Stay
Room Capacity
Price
Fajr Alnosok Company
08/10/2026
08/15/2026
5
3
1260 SAR
Service
Service Type
Visit Date
Time
Guide
Price
Islamic Manuscripts Museum (King Abdullah Library - Umm Al-Qura University)
Enrichment Destinations
2026-08-11
07:37:00
30 SAR
Details
Price
MAZARAT
25 SAR
Add trip station
(15/08/2026) Departure Journey
Travel Method
Departure Date
2026-08-15
Transport Method
Air Transport Sea Transport Land Transport
leaving from
Saudi Arabia, Jeddah
Going to
Egypt, Cairo
Flight Number
MS-0672
Airport
King Abdul Aziz International Airport
Airlines
EGYPT AIR
Terminal
TERMINAL 1
Departure Time
18:30
Type of Trip
Scheduled Flight
Browse Journeys
Back Next
Trip Information Summary
Trip Route
Arrival Date (Air Transport)
5-8-2026
Trip Stations
Madina
Makkah
Departure Date (Air Transport)
15-8-2026`;

    const rows = parseItineraryTextEN(realCaptureText, groupInfo);
    const services = rows.filter(r => r.Column1 === 'Enrichment Service');

    expect(services).toHaveLength(3);
    expect(services.map(s => s.to)).toEqual([
      'Quba Avenue',
      "Sayyid al-Shuhada' - Uhud Area",
      'Islamic Manuscripts Museum (King Abdullah Library - Umm Al-Qura University)',
    ]);

    const departure = rows.find(r => r.Column1 === 'Departure');
    expect(departure?.from).toBe('Fajr Alnosok Company (Makkah)');
  });
});
