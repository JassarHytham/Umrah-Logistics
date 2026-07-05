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
