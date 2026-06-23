## Task 2: Wire Agency Through App UI, Import, And Export

Files changed:
- `App.tsx`
- `tests/tableColumns.test.ts`
- `tests/rowStateActions.test.ts` (minimal `LogisticsRow.agency` fixture addition for TypeScript)

Tests run:
- `npm test -- tests/tableColumns.test.ts` before app wiring: passed, 2 tests.
- `npm run lint`: failed due to unrelated pre-existing `chrome extention/umrah-extension/SERVER_ENDPOINT.ts` undefined symbols (`app`, `authenticateToken`, `db`, `parseItineraryText`); the agency fixture error was fixed and did not recur.
- `npm test -- tests/tableColumns.test.ts` after implementation: passed, 2 tests.

Results:
- Manual input state now initializes and preserves `agency`.
- Manual extraction passes `agency: inputs.agency || ''` to `parseItineraryText`.
- The manual form includes visible label `الوكيل`.
- Excel export writes `الوكيل` after `اسم المجموعة`.
- Excel import accepts `الوكيل`, `اسم الوكيل الرئيسي`, `Agency`, `Main Agent`, and `اسم_الوكيل_الرئيسي`.
- New empty rows include `agency: ''`.
- Group sharing semantics were not changed.

Commit hash:
- `c40db7406342b37f5b2c97ef869a828f6eada291`

Concerns:
- `npm run lint` remains blocked by extension endpoint TypeScript errors outside Task 2 scope.
