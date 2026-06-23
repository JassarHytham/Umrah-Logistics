# Agency Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared `agency` field shown as `الوكيل`, captured from Nusuk `eaName`, and carried through parsing, ingest, table display, import, export, and sharing.

**Architecture:** Store `agency` inside each trip row JSON payload, matching existing group metadata. Extend the parser group metadata path so all extracted rows inherit the value. Capture the value in the Chrome extension from `td[id="eaName"]` and pass it through the existing `/api/ingest/text` pipeline.

**Tech Stack:** React 19, TypeScript, Vite, Express, SQLite JSON row payloads, Vitest, Node `node:test` extension tests, Chrome extension MV3 scripts.

## Global Constraints

- Visible app column label is exactly `الوكيل`.
- Row field name is exactly `agency`.
- Nusuk source cell is `td[id="eaName"]`, corresponding to `اسم الوكيل الرئيسي`.
- `agency` is optional on inbound group metadata and defaults to an empty string when missing.
- No SQL migration is required because logistics rows are stored in `logistics_rows.data` JSON.
- Group sharing continues to be keyed by `groupNo`; `agency` is shared because it is part of the canonical row JSON.
- Use TDD: write each focused test first, run it red, then implement.

---

## File Structure

- Modify `types.ts`: add `agency` to `LogisticsRow`, optional `agency` to `GroupInfo`, default column order, and Arabic column label.
- Modify `utils/parser.ts`: preserve `agency` through existing `groupInfo` spreading and normalize missing agency to `""`.
- Modify `tests/parser.test.ts`: prove parser rows carry agency.
- Create `tests/tableColumns.test.ts`: prove the new table column is exposed in constants.
- Modify `App.tsx`: add manual agency input, pass agency into parsing, include agency in empty rows, Excel export, and Excel import.
- Modify `server.ts`: accept optional `agency` in `/api/ingest/text` and pass it to the parser.
- Modify `tests/server.test.ts`: prove ingest returns and stores agency.
- Modify `chrome extention/umrah-extension/auto-logic.js`: add pure `extractGroupRowData(row, cellText)` helper.
- Modify `chrome extention/umrah-extension/content.js`: use helper or matching extraction to include `agency` from `eaName`.
- Modify `chrome extention/umrah-extension/background.js`: persist and send agency in auto-capture flows.
- Modify `chrome extention/umrah-extension/popup.html`: add optional agency input.
- Modify `chrome extention/umrah-extension/popup.js`: populate, persist, validate-neutral, and send agency in manual extension flow.
- Modify `chrome extention/umrah-extension/test/auto-logic.test.js`: prove helper captures agency.

---

### Task 1: Add Agency To Types And Parser Metadata

**Files:**
- Modify: `types.ts`
- Modify: `utils/parser.ts`
- Modify: `tests/parser.test.ts`
- Create: `tests/tableColumns.test.ts`

**Interfaces:**
- Consumes: existing `parseItineraryText(text: string, groupInfo: GroupInfo): LogisticsRow[]`.
- Produces: `LogisticsRow.agency: string`, `GroupInfo.agency?: string`, `COLUMN_LABELS.agency === "الوكيل"`, and `DEFAULT_COLUMN_ORDER` containing `agency`.

- [ ] **Step 1: Write the failing parser test**

Add this test inside the existing `describe('parseItineraryText', ...)` block in `tests/parser.test.ts` after `all rows carry group info`:

```ts
  it('all rows carry agency when provided in group info', () => {
    const rows = parseItineraryText(sampleItinerary, { ...groupInfo, agency: 'اميرة ترافيل' });
    for (const row of rows) {
      expect(row.agency).toBe('اميرة ترافيل');
    }
  });
```

- [ ] **Step 2: Write the failing table constants test**

Create `tests/tableColumns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COLUMN_LABELS, DEFAULT_COLUMN_ORDER } from '../types';

describe('table column constants', () => {
  it('exposes agency as الوكيل near group metadata', () => {
    expect(COLUMN_LABELS.agency).toBe('الوكيل');
    expect(DEFAULT_COLUMN_ORDER).toContain('agency');
    expect(DEFAULT_COLUMN_ORDER.indexOf('agency')).toBeGreaterThan(DEFAULT_COLUMN_ORDER.indexOf('groupName'));
    expect(DEFAULT_COLUMN_ORDER.indexOf('agency')).toBeLessThan(DEFAULT_COLUMN_ORDER.indexOf('Column1'));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/parser.test.ts tests/tableColumns.test.ts
```

Expected:

```text
FAIL tests/parser.test.ts
FAIL tests/tableColumns.test.ts
```

The parser test should fail because `row.agency` is missing or undefined. The constants test should fail because `COLUMN_LABELS.agency` and the default column order do not exist yet.

- [ ] **Step 4: Implement minimal type and parser changes**

In `types.ts`, update `LogisticsRow`:

```ts
export interface LogisticsRow {
  id: string;
  groupNo: string;
  groupName: string;
  agency: string;
  count: string;
  Column1: string;
  date: string;
  time: string;
  flight: string;
  from: string;
  to: string;
  carType: string;
  tafweej: string;
  status: TripStatus;
  notes?: string;
  _sharing?: SharedMetadata;
  [key: string]: string | number | SharedMetadata | undefined;
  _originalIndex?: number;
  _version?: number;
}
```

In `types.ts`, update `GroupInfo`:

```ts
export interface GroupInfo {
  groupNo: string;
  groupName: string;
  agency?: string;
  count: string;
}
```

In `types.ts`, update `DEFAULT_COLUMN_ORDER`:

```ts
export const DEFAULT_COLUMN_ORDER: string[] = [
  'status', 'groupNo', 'groupName', 'agency', 'Column1', 'tafweej',
  'carType', 'from', 'to', 'time', 'flight', 'date', 'count',
  'notes', 'actions',
];
```

In `types.ts`, update `COLUMN_LABELS`:

```ts
  agency:   'الوكيل',
```

Place it after `groupName`.

In `utils/parser.ts`, add a normalized group info object near the top of `parseItineraryText` after `carType`:

```ts
  const rowGroupInfo = { ...groupInfo, agency: groupInfo.agency || "" };
```

Then replace every row spread of `...groupInfo` inside `parseItineraryText` with:

```ts
          ...rowGroupInfo,
```

or:

```ts
              ...rowGroupInfo,
```

depending on indentation.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm test -- tests/parser.test.ts tests/tableColumns.test.ts
```

Expected:

```text
PASS tests/parser.test.ts
PASS tests/tableColumns.test.ts
```

- [ ] **Step 6: Commit Task 1**

```bash
git add types.ts utils/parser.ts tests/parser.test.ts tests/tableColumns.test.ts
git commit -m "feat: add agency metadata to logistics rows"
```

---

### Task 2: Wire Agency Through App UI, Import, And Export

**Files:**
- Modify: `App.tsx`
- Test: `tests/tableColumns.test.ts`

**Interfaces:**
- Consumes: `InputState` now allows `agency?: string`, `LogisticsRow.agency`.
- Produces: manual extraction passes agency, empty rows include agency, Excel import/export include agency.

- [ ] **Step 1: Extend the constants test before app wiring**

Update `tests/tableColumns.test.ts` with a second assertion showing the field is part of the public export/import label contract:

```ts
  it('uses stable agency labels for import and export mapping', () => {
    const agencyLabels = ['الوكيل', 'اسم الوكيل الرئيسي', 'Agency', 'Main Agent', 'اسم_الوكيل_الرئيسي'];
    expect(agencyLabels).toContain(COLUMN_LABELS.agency);
  });
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
npm test -- tests/tableColumns.test.ts
```

Expected:

```text
PASS tests/tableColumns.test.ts
```

This test passes before app wiring because it locks the field label contract that the app code must use.

- [ ] **Step 3: Add agency to input state and extraction**

In `App.tsx`, change the input state initialization:

```ts
  const [inputs, setInputs] = useState<InputState>({ groupNo: '', groupName: '', agency: '', count: '', text: '' });
```

In `handleExtract`, change the parser call:

```ts
    const rows = parseItineraryText(inputs.text, {
      groupNo: inputs.groupNo,
      groupName: inputs.groupName,
      agency: inputs.agency || '',
      count: inputs.count
    });
```

When approving preview rows, keep agency in the input state and clear only text:

```ts
setInputs({ ...inputs, text: '' });
```

- [ ] **Step 4: Add the manual agency input**

In the manual group fields in `App.tsx`, add this input between group name and count:

```tsx
                    <input type="text" placeholder="الوكيل" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[44px]" value={inputs.agency || ''} onChange={(e) => setInputs({ ...inputs, agency: e.target.value })} />
```

- [ ] **Step 5: Add agency to Excel export**

In `downloadExcel`, add this property after `"اسم المجموعة"`:

```ts
        "الوكيل": row.agency || '',
```

- [ ] **Step 6: Add agency to Excel import**

In `handleFileUpload`, add this property in the imported row object after `groupName`:

```ts
              agency: String(getVal(r, ['الوكيل', 'اسم الوكيل الرئيسي', 'Agency', 'Main Agent', 'اسم_الوكيل_الرئيسي']) || ''),
```

- [ ] **Step 7: Add agency to empty rows**

In `addNewEmptyRow`, add:

```ts
      agency: '',
```

Place it after `groupName`.

- [ ] **Step 8: Run type check**

Run:

```bash
npm run lint
```

Expected:

```text
> tsc --noEmit
```

The command exits with status 0 and no TypeScript errors.

- [ ] **Step 9: Commit Task 2**

```bash
git add App.tsx tests/tableColumns.test.ts
git commit -m "feat: wire agency through app table flows"
```

---

### Task 3: Capture Agency In The Chrome Extension

**Files:**
- Modify: `chrome extention/umrah-extension/auto-logic.js`
- Modify: `chrome extention/umrah-extension/content.js`
- Modify: `chrome extention/umrah-extension/background.js`
- Modify: `chrome extention/umrah-extension/popup.html`
- Modify: `chrome extention/umrah-extension/popup.js`
- Modify: `chrome extention/umrah-extension/test/auto-logic.test.js`

**Interfaces:**
- Consumes: Nusuk row cell IDs `groupNumber`, `groupName`, `mutamerNumber`, and `eaName`.
- Produces: group metadata object `{ groupNo, groupName, agency, count }` persisted and sent by the extension.

- [ ] **Step 1: Write the failing extension helper test**

Modify the import in `chrome extention/umrah-extension/test/auto-logic.test.js`:

```js
const { normalizeText, fnv1aHash, isValidSnapshot, extractGroupRowData } = require('../auto-logic.js');
```

Add this test at the end:

```js
test('extractGroupRowData captures agency from eaName cell', () => {
  const cells = {
    groupNumber: '480900139756',
    groupName: 'Amirah July Grp 1',
    mutamerNumber: '6',
    eaName: 'اميرة ترافيل',
  };
  const row = {
    querySelector(selector) {
      const match = selector.match(/td\[id="([^"]+)"\]/);
      const id = match && match[1];
      return id && cells[id] !== undefined ? { textContent: cells[id] } : null;
    },
  };
  const cellText = (td) => (td ? td.textContent.trim() : '');

  assert.deepStrictEqual(extractGroupRowData(row, cellText), {
    groupNo: '480900139756',
    groupName: 'Amirah July Grp 1',
    agency: 'اميرة ترافيل',
    count: '6',
  });
});
```

- [ ] **Step 2: Run extension helper test red**

Run:

```bash
node --test "chrome extention/umrah-extension/test/auto-logic.test.js"
```

Expected:

```text
not ok ... extractGroupRowData captures agency from eaName cell
```

The failure should say `extractGroupRowData` is not a function or is undefined.

- [ ] **Step 3: Implement the pure helper**

In `chrome extention/umrah-extension/auto-logic.js`, add this function before the `return` statement:

```js
  function extractGroupRowData(row, cellText) {
    return {
      groupNo: cellText(row.querySelector('td[id="groupNumber"]')),
      groupName: cellText(row.querySelector('td[id="groupName"]')),
      agency: cellText(row.querySelector('td[id="eaName"]')),
      count: cellText(row.querySelector('td[id="mutamerNumber"]')),
    };
  }
```

Update the returned API:

```js
  return { normalizeText, fnv1aHash, isValidSnapshot, extractGroupRowData };
```

- [ ] **Step 4: Use the helper in content.js**

In `chrome extention/umrah-extension/content.js`, replace `extractRowData(row)` with:

```js
  function extractRowData(row) {
    if (window.UmrahAutoLogic && typeof window.UmrahAutoLogic.extractGroupRowData === 'function') {
      return window.UmrahAutoLogic.extractGroupRowData(row, cellText);
    }
    return {
      groupNo:   cellText(row.querySelector('td[id="groupNumber"]')),
      groupName: cellText(row.querySelector('td[id="groupName"]')),
      agency:    cellText(row.querySelector('td[id="eaName"]')),
      count:     cellText(row.querySelector('td[id="mutamerNumber"]')),
    };
  }
```

- [ ] **Step 5: Persist agency in background auto-capture**

In `chrome extention/umrah-extension/background.js`, update the `GROUP_KEY` mirror object:

```js
      set({ [GROUP_KEY]: {
        groupNo: af.newValue.groupNo,
        groupName: af.newValue.groupName,
        agency: af.newValue.agency || '',
        count: af.newValue.count || ''
      }});
```

Update the ingest request body:

```js
        text, groupNo: group.groupNo, groupName: group.groupName,
        agency: group.agency || '',
        count: group.count, overwrite: !!overwrite
```

- [ ] **Step 6: Add optional agency input to popup.html**

In `chrome extention/umrah-extension/popup.html`, add this field after the group name field:

```html
      <div class="field-group full-width">
        <label class="field-label">الوكيل</label>
        <input id="agency" type="text" class="input" placeholder="اسم الوكيل الرئيسي" />
      </div>
```

- [ ] **Step 7: Wire popup.js agency**

In `chrome extention/umrah-extension/popup.js`, add the DOM ref:

```js
const agency          = document.getElementById('agency');
```

Populate it from fresh autofill:

```js
    agency.value     = autofill.agency    || '';
```

Populate it from stored group:

```js
    agency.value     = g.agency || '';
```

Include it in input listeners:

```js
[groupName, agency, groupCount].forEach(el => el.addEventListener('input', updateSendButton));
```

In `doSend`, read it:

```js
  const gAgency = agency.value.trim();
```

Send it to the backend:

```js
      text, groupNo: gNo, groupName: gName, agency: gAgency, count: gCnt, overwrite
```

Persist it:

```js
    await chrome.storage.local.set({ [STORAGE_KEY_GROUP]: { groupNo: gNo, groupName: gName, agency: gAgency, groupCount: gCnt } });
```

- [ ] **Step 8: Run extension tests green**

Run:

```bash
node --test "chrome extention/umrah-extension/test/auto-logic.test.js"
node --test "chrome extention/umrah-extension/test/auto-capture.test.js"
```

Expected:

```text
# pass
```

Both commands exit with status 0.

- [ ] **Step 9: Commit Task 3**

```bash
git add "chrome extention/umrah-extension/auto-logic.js" "chrome extention/umrah-extension/content.js" "chrome extention/umrah-extension/background.js" "chrome extention/umrah-extension/popup.html" "chrome extention/umrah-extension/popup.js" "chrome extention/umrah-extension/test/auto-logic.test.js"
git commit -m "feat(ext): capture agency from group rows"
```

---

### Task 4: Accept Agency In Server Ingest

**Files:**
- Modify: `server.ts`
- Modify: `tests/server.test.ts`

**Interfaces:**
- Consumes: request body field `agency?: string` on `POST /api/ingest/text`.
- Produces: parsed rows returned and stored with `agency`.

- [ ] **Step 1: Write failing server ingest test**

In `tests/server.test.ts`, find `describe('Extension text ingest with deleted rows', ...)` and add this test after the existing ingest test in that describe block:

```ts
  it('stores agency from extension text ingest on every parsed row', async () => {
    const user = await registerSharedTestUser('ingest_agency_user');
    const groupNo = `AGENCY${Date.now()}`;
    const ingestText = `
رحلة الوصول
تاريخ الوصول
2026-07-08
وقت الوصول
14:30
رقم الرحلة
SV123
المطار
JED

رحلة المغادرة
تاريخ المغادرة
2026-07-15
وقت المغادرة
10:00
رقم الرحلة
SV456
المطار
MED
`;

    const ingest = await request(app)
      .post('/api/ingest/text')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        text: ingestText,
        groupNo,
        groupName: 'Agency Group',
        agency: 'اميرة ترافيل',
        count: '6',
      });

    expect(ingest.status).toBe(200);
    expect(ingest.body.rows.length).toBeGreaterThan(0);
    expect(ingest.body.rows.every((row: any) => row.agency === 'اميرة ترافيل')).toBe(true);

    const rows = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${user.token}`);

    expect(rows.status).toBe(200);
    const storedRows = rows.body.filter((row: any) => row.groupNo === groupNo);
    expect(storedRows.length).toBe(ingest.body.rows.length);
    expect(storedRows.every((row: any) => row.agency === 'اميرة ترافيل')).toBe(true);
  });
```

- [ ] **Step 2: Run server test red**

Run:

```bash
npm test -- tests/server.test.ts
```

Expected:

```text
FAIL tests/server.test.ts
```

The new test should fail because `/api/ingest/text` ignores `agency` and parsed rows do not include the value.

- [ ] **Step 3: Implement ingest agency support**

In `server.ts`, update the comment:

```ts
// Body: { text, groupNo, groupName, agency?, count, overwrite? }
```

Update destructuring:

```ts
  const { text, groupNo, groupName, agency = "", count, overwrite = false } = req.body;
```

Update the parser call:

```ts
    const newRows = parseItineraryText(text.trim(), {
      groupNo: String(groupNo).trim(),
      groupName: String(groupName).trim(),
      agency: String(agency || "").trim(),
      count: String(count).trim(),
    });
```

- [ ] **Step 4: Run server test green**

Run:

```bash
npm test -- tests/server.test.ts
```

Expected:

```text
PASS tests/server.test.ts
```

- [ ] **Step 5: Commit Task 4**

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: accept agency during extension ingest"
```

---

### Task 5: Final Verification

**Files:**
- Verify all modified files from Tasks 1-4.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: a verified agency field across parser, app, extension, and server ingest.

- [ ] **Step 1: Run focused parser and constants tests**

```bash
npm test -- tests/parser.test.ts tests/tableColumns.test.ts
```

Expected:

```text
PASS tests/parser.test.ts
PASS tests/tableColumns.test.ts
```

- [ ] **Step 2: Run focused server tests**

```bash
npm test -- tests/server.test.ts
```

Expected:

```text
PASS tests/server.test.ts
```

- [ ] **Step 3: Run extension tests**

```bash
node --test "chrome extention/umrah-extension/test/auto-logic.test.js"
node --test "chrome extention/umrah-extension/test/auto-capture.test.js"
```

Expected:

```text
# pass
```

Both commands exit with status 0.

- [ ] **Step 4: Run TypeScript check**

```bash
npm run lint
```

Expected:

```text
> tsc --noEmit
```

The command exits with status 0.

- [ ] **Step 5: Check working tree**

```bash
git status --short
```

Expected: only unrelated pre-existing user files remain, or no output if the tree is clean.

- [ ] **Step 6: Commit final verification notes if any tracked docs changed during execution**

If execution updates this plan with checked boxes, commit only this plan file:

```bash
git add docs/superpowers/plans/2026-06-23-agency-column.md
git commit -m "docs: update agency column plan progress"
```

