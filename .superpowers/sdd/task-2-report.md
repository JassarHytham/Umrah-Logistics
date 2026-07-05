# Task 2 Report: Add The Simple View Toggle And Summary Table

## Scope

- Modified `components/TableEditor.tsx`
- Modified `tests/simpleTripView.test.ts`
- Preserved the existing local `showPastTrips` auto-expand behavior when filters are active

## What Changed

- Added the required summary ordering test to `tests/simpleTripView.test.ts`
- Added local `viewMode` state in `TableEditor` to switch between `detailed` and `simple`
- Added local `selectedSimpleTrip` state and a details overlay for simple summaries
- Wired `buildSimpleTripSummaries(filteredRows)` through `useMemo`
- Added the toolbar toggle with the exact `Detailed` / `Simple` labels from the brief
- Rendered the existing detailed table only in detailed mode
- Added the simple summary table with the required Arabic headers and `عرض التفاصيل` action

## Verification

### RED

- Ran: `npm test -- tests/simpleTripView.test.ts`
- Result: `PASS`
- Observation: the helper already satisfied the new ordering expectation, so no helper change was needed before UI work

### GREEN / Final Verification

- Ran: `npm run lint`
- Result: `FAIL`
- Failure source: pre-existing TypeScript errors in `chrome extention/umrah-extension 2/SERVER_ENDPOINT.ts`
- Relevant errors:
  - `Cannot find name 'app'`
  - `Cannot find name 'authenticateToken'`
  - `Cannot find name 'db'`
  - `Cannot find name 'parseItineraryText'`

- Ran: `npm test -- tests/simpleTripView.test.ts`
- Result: `PASS` (`1` file, `8` tests)

- Ran extra targeted check to isolate this task from the repo-wide lint failure:
  - `npx tsc --noEmit --pretty false --jsx react-jsx --target ESNext --lib DOM,DOM.Iterable,ESNext --module ESNext --moduleResolution Node --strict --skipLibCheck --allowSyntheticDefaultImports components/TableEditor.tsx`
  - Result: `PASS`

## Self-Review

- Confirmed the simple view uses `filteredRows`, so it stays aligned with current filters/sorting inputs
- Confirmed the existing detailed table path remains intact behind the mode toggle
- Confirmed the local auto-expand effect for past trips was preserved
- Confirmed the new details button opens a usable overlay rather than setting dead state

## Concerns

- `npm run lint` is not clean on this branch because of unrelated pre-existing TypeScript errors outside task scope

## Reviewer Fix Follow-Up

- Root cause: simple-mode summaries were built from `filteredRows`, so filtering a single segment could truncate the itinerary chain used for both summary values and the details popup
- Fix: added `buildSimpleViewSummaries(rows, filteredRows)` in `TableEditor.tsx` so simple view still shows only groups present in the filtered set, but each visible summary is rebuilt from the full row set for that group
- Regression coverage: added a focused test that exercises the TableEditor simple-view data flow and proves a partially filtered group still keeps its full itinerary and final status

### Follow-Up Verification

- Ran: `npm test -- tests/simpleTripView.test.ts`
- Result: `PASS` (`1` file, `9` tests)

- Ran: `npx tsc --noEmit --pretty false --jsx react-jsx --target ESNext --lib DOM,DOM.Iterable,ESNext --module ESNext --moduleResolution Node --strict --skipLibCheck --allowSyntheticDefaultImports components/TableEditor.tsx`
- Result: `PASS`
