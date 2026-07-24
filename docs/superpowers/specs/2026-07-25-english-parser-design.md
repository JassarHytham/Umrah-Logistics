# English Itinerary Parser — Design Spec
**Date:** 2026-07-25
**Status:** Approved

## Problem

`utils/parser.ts` extracts trip rows from raw text captured (via the Chrome extension's `innerText` scrape of `app-trip-info`) from an external Angular booking portal. The parser works by pattern-matching the portal's **Arabic** UI labels (`رحلة الوصول`, `المطار`, `الوجهة`, `تاريخ المغادرة`, etc.). The portal also has an English locale mode, which produces analogous but differently-labeled text. Today, any English-mode capture produces zero usable rows because none of the Arabic label regexes match.

This is part of a larger multi-language initiative (full UI i18n, a language switcher, and cross-language agent-identity mapping via `groupNo`), but those are separate sub-projects with their own specs. This spec covers only the parsing layer: given English-mode captured text, produce the same `LogisticsRow[]` shape the Arabic parser produces, with the same completeness and edge-case handling.

## Ground Truth Sample

A real English-mode capture (single-destination, air-transport-only) was provided and used to derive the label structure below:

```
Arrival Journey ... Arrival Date: 2026-08-24 ... Coming From: Sudan, Alkhartom
Going to: Saudi Arabia, Jeddah ... Flight Number: 3T-0204 ... Airport: King Abdul
Aziz International Airport ... Airlines: TARCO AIR ... Terminal: NORTH TERMINAL
Arrival Time: 17:15 ... Type of Trip: Scheduled Flight ... Browse Journeys

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

Departure Journey ... (mirrors Arrival Journey structure) ...

Trip Information Summary
Trip Route
Arrival Date (Air Transport)
24-8-2026
Trip Stations
Makkah
Departure Date (Air Transport)
27-8-2026
```

Confirmed structural parity with the Arabic version: destination-block pattern (`Destination (City)` ↔ `الوجهة (المدينة)`), arrival/departure stop-label sequences, the summary section, and the "Add trip station" boundary marker (`اضافة محطه للرحلة`) all correspond 1:1. Flight-number values are Latin script in both languages (e.g. `3T-0204`), so the existing capture regex is reusable unchanged.

One genuine divergence: the Arabic hotel table reuses `تاريخ المغادرة` (Departure Date) for hotel checkout, disambiguated only by block-scoping. English uses a distinct `Exit Date` label, so that ambiguity doesn't exist on the English side — no special-casing needed there.

**Not covered by the sample** (land transport, sea transport, multi-city "between cities" legs): English labels for these are inferred by direct translation of their Arabic counterparts (e.g. `المنفذ` → `Port`, `نوع الناقل`/`شركة النقل` → `Carrier Type`/`Transport Company`). These are marked `// UNVERIFIED` in code and must be validated against a real capture before being trusted in production.

## Decision

Add a new, structurally independent module rather than parameterizing the existing Arabic parser.

**Why not a shared parameterized engine:** `utils/parser.ts` is ~470 lines of regex tuned against real capture quirks over multiple production bug-fix cycles (most recently for alphanumeric flight codes). Forcing both languages through one generic function, with labels swapped via a config object, would require touching that proven code path and risks regressing live Arabic parsing for a code-reuse gain that doesn't hold anyway — at least one structural divergence (the hotel date-label collision) already breaks a clean 1:1 parameterization.

**What is shared:** the language-agnostic pure functions — `formatDate`, `parseDateTime`, `uid` — have zero Arabic/English dependency (they operate on already-extracted date/time strings) and are imported directly from `utils/parser.ts`, not duplicated. `formatDate` and `parseDateTime` are already exported; `uid` is currently private to `parser.ts` and needs an `export` added (additive, no behavior change, no risk to existing callers).

## File Structure

New file: `utils/parserEN.ts`

```ts
import { formatDate, parseDateTime, uid } from './parser'; // reused, not duplicated

export const AIRPORT_MAP_EN: Record<string, string> = {
  "King Abdul Aziz International Airport": "Jeddah",
  "King Abdulaziz International Airport": "Jeddah",
  "JED": "Jeddah",
  "Prince Mohammed Bin Abdulaziz Airport": "Madinah", // UNVERIFIED label text
  "MED": "Madinah",
  "Taif Airport": "Taif", // UNVERIFIED label text
  "Jeddah": "Jeddah",
  "Madinah": "Madinah",
  "Medina": "Madinah",
  "Makkah": "Makkah",
  "Mecca": "Makkah",
  "Cairo": "Cairo",
};

const CAR_TYPES_EN = { SEDAN: "Sedan", GMC: "GMC", BUS: "Bus" };

export const getCarTypeEN = (count: string): string => { /* same thresholds as getCarType, English labels */ };
export const normalizeCityEN = (text: string | null | undefined): string => { /* mirrors normalizeCity against AIRPORT_MAP_EN */ };
const normalizeFlattenedCaptureEN = (raw: string): string => { /* mirrors normalizeFlattenedCapture with English section-header line-break rules, e.g. the Hotels table header */ };

export const parseItineraryTextEN = (text: string, groupInfo: GroupInfo): LogisticsRow[] => {
  // Mirrors parseItineraryText's control flow exactly:
  // destBlocks extraction, arrival/departure parsing, enrichment services,
  // between-cities rows, fallback "Unspecified" row — using English labels/regex.
};
```

Key label correspondences (Arabic → English) driving the regexes:

| Concept | Arabic | English |
|---|---|---|
| Arrival journey marker | `رحلة الوصول` | `Arrival Journey` |
| Departure journey marker | `رحلة المغادرة` | `Departure Journey` |
| Destination block | `الوجهة\s*\(([^)]+)\)` | `Destination\s*\(([^)]+)\)` |
| Flight number label | `رقم الرحلة` | `Flight Number` |
| Airport label | `المطار` | `Airport` |
| Arrival stop-labels | `الخطوط الجوية, الصالة, وقت الوصول, نوع الرحلة, استعراض الرحلات, الوجهة` | `Airlines, Terminal, Arrival Time, Type of Trip, Browse Journeys, Destination` |
| Departure stop-labels | `...عودة, التالي, ملخص معلومات الرحلة` | `...Trip Information Summary` |
| Arrival/Departure time | `وقت الوصول` / `وقت المغادرة` | `Arrival Time` / `Departure Time` |
| Hotel table header | `اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر` | `Hotel / Host Name Entrance Date Exit Date Duration Of Stay Room Capacity Price` |
| Enrichment services header | `الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر` | `Service Service Type Visit Date Time Guide Price` |
| Section boundary markers | `اضف/إضافة خدمات إضافية`, `اضافة محطه للرحلة` | `Additional Services`, `Add trip station` |
| Land transport marker | `المنفذ`, `نوع الناقل`/`شركة النقل` | `Port`, `Carrier Type`/`Transport Company` *(UNVERIFIED)* |

## Routing — Auto-Detected, No Client Changes

The provided sample contains zero Arabic Unicode characters anywhere (place names, airline names, hotel names are all Latin script), so language is detected server-side from the text itself — no new request field, no Chrome extension changes for routing.

New shared helper, `utils/langDetect.ts`:

```ts
export const detectCaptureLang = (text: string): 'ar' | 'en' =>
  /[؀-ۿ]/.test(text) ? 'ar' : 'en';
```

Both call sites switch on this:

- `server.ts` `/api/ingest/text` (used by both the Chrome extension and the app's manual paste form)
- `App.tsx`'s manual-paste handler (client-side preview path, mirrors the server logic)

```ts
const rows = detectCaptureLang(text) === 'ar'
  ? parseItineraryText(text, groupInfo)
  : parseItineraryTextEN(text, groupInfo);
```

This is fully backward compatible: existing Arabic-only callers are unaffected since their text always contains Arabic characters.

## Output Language

A parsed English capture produces an **English-content row** — `Column1`, `from`, `to`, `tafweej`, `carType` are all in English (e.g. `Column1: "Arrival"` instead of `"وصول"`), exactly mirroring how the Arabic parser produces Arabic content from Arabic input. `groupNo`/`groupName`/`agency` pass through unchanged from the caller-supplied `groupInfo`. `status` stays `'Planned'` (already a language-neutral enum key).

**Explicitly out of scope for this spec:** making `Column1`/`carType`/`from`/`to`/`tafweej` re-translate when a future language switcher changes the UI language. That would require canonicalizing these currently-free-text fields into enum keys with a separate label-lookup table (the same pattern `TripStatus` already uses via `STATUS_CONFIG`/`STATUS_LABELS`) — a materially different, larger change that belongs to the UI i18n sub-project, if pursued at all. Only `agency` gets cross-language identity treatment, and that's specified separately under the cross-language agent-identity sub-project.

## Known Gaps (flagged, not blocking)

- Land transport, sea transport, and multi-city "between cities" English labels are inferred by translation, not verified against a real capture. They ship with `// UNVERIFIED` comments and should be corrected against real samples when available.
- `AIRPORT_MAP_EN` covers the airports named in the sample plus reasonable extrapolation from the Arabic map; like `AIRPORT_MAP`, it's a living map expected to grow as new airport names are observed.

## Testing

New `tests/parserEN.test.ts`, mirroring `tests/parser.test.ts`'s structure:

- unit tests for `getCarTypeEN`, `normalizeCityEN` (boundary values, unknown input)
- golden-path integration test using the real provided sample end-to-end, asserting the full `LogisticsRow[]` output (arrival row, hotel-destination handling, enrichment service row, departure row)
- edge cases mirrored from the existing Arabic suite where applicable: alphanumeric flight codes, missing sections, fallback "Unspecified" row when no rows extract
- `detectCaptureLang` unit tests: pure Arabic, pure English (the real sample), mixed content

Existing `tests/parser.test.ts` (73 tests) must continue passing unmodified — this work touches no code inside `utils/parser.ts`.

## Found But Out Of Scope Here

`chrome extention/umrah-extension/auto-logic.js`'s `isValidSnapshot()` hard-checks for the literal strings `'رحلة الوصول'` and `'رحلة المغادرة'` before allowing a send — it will currently reject every English-mode capture outright, regardless of this parser change. That belongs to the separate "Chrome extension English support" sub-project and its own spec.
