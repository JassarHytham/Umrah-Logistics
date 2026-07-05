# Task 1 Report: Build Summary Helpers

## Result
- Implemented `utils/simpleTripView.ts` with `SimpleTripStay`, `SimpleTripSummary`, and `buildSimpleTripSummaries(rows)`.
- Added `tests/simpleTripView.test.ts` covering group collapse, hotel extraction, enrichment-row exclusion from duration math, and fallback handling when Mecca has no later intercity leg.

## Verification
- Ran: `npm test -- tests/simpleTripView.test.ts`
- Result: passed

## Notes
- Only the two requested files were created.
- `components/TableEditor.tsx` and other unrelated worktree changes were left untouched.

## Update
- Fixed hotel detection so parenthesized airports and landmarks are no longer treated as hotels.
- Fixed Madina city detection so it no longer relies on the bare generic marker `مدينة`.
- Re-ran: `npm test -- tests/simpleTripView.test.ts`
- Result: passed
