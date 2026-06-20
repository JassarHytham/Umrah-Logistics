# Column Visibility & Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users show/hide and reorder table columns from the Display settings page, persisted to the server.

**Architecture:** Two new fields (`columnOrder`, `hiddenColumns`) added to `DisplaySettings`. `TableEditor` reads them to filter and sort its `headers` array. A draggable list in the Display settings page (after the wrap-cells toggle) is the control surface. Persistence is free — `displaySettings` already saves to `extra_settings` on the server.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, lucide-react, native HTML5 drag-and-drop (no new dependencies)

## Global Constraints

- No new npm dependencies
- RTL layout — drag handles go on the right side of each row (trailing edge in RTL)
- Arabic labels only (no English shown to user)
- `npm run lint` (`tsc --noEmit`) must pass after every task
- All column keys must match exactly: `status`, `groupNo`, `groupName`, `Column1`, `tafweej`, `carType`, `from`, `to`, `time`, `flight`, `date`, `count`, `notes`, `actions`
- `notes` and `actions` keep their existing conditional logic (`isPreview`/`readOnly`) applied on top of user settings

---

### Task 1: Extend `types.ts` with new fields and shared constants

**Files:**
- Modify: `types.ts`

**Interfaces:**
- Produces:
  - `DisplaySettings.columnOrder: string[]`
  - `DisplaySettings.hiddenColumns: string[]`
  - `export const DEFAULT_COLUMN_ORDER: string[]`
  - `export const COLUMN_LABELS: Record<string, string>`

- [ ] **Step 1: Add constants and fields to `types.ts`**

In `types.ts`, add the following **before** the `DisplaySettings` interface:

```typescript
export const DEFAULT_COLUMN_ORDER: string[] = [
  'status', 'groupNo', 'groupName', 'Column1', 'tafweej',
  'carType', 'from', 'to', 'time', 'flight', 'date', 'count',
  'notes', 'actions',
];

export const COLUMN_LABELS: Record<string, string> = {
  status:    'الحالة',
  groupNo:   'رقم م',
  groupName: 'اسم المجموعة',
  Column1:   'الحركة',
  tafweej:   'التفويج',
  carType:   'السيارة',
  from:      'من',
  to:        'إلى',
  time:      'وقت',
  flight:    'رحلة',
  date:      'تاريخ',
  count:     'عدد',
  notes:     'الملاحظات',
  actions:   'إجراءات',
};
```

Then add two fields to the `DisplaySettings` interface:

```typescript
export interface DisplaySettings {
  density: 'compact' | 'comfortable';
  tableFontSize: number;
  borderStyle: 'thin' | 'medium' | 'thick';
  noteHighlightEnabled: boolean;
  noteHighlightColor: NoteHighlightColor;
  wrapCells: boolean;
  columnOrder: string[];    // ordered array of column keys
  hiddenColumns: string[];  // keys of columns to hide
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/jassar/Projects/Umrah/Umrah-Logistics && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types.ts
git commit -m "feat(types): add columnOrder and hiddenColumns to DisplaySettings"
```

---

### Task 2: Update `App.tsx` defaults and pass new props to `TableEditor`

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `DEFAULT_COLUMN_ORDER` from `../types`
- Produces: `columnOrder` and `hiddenColumns` props wired to `<TableEditor>`

- [ ] **Step 1: Import `DEFAULT_COLUMN_ORDER` in `App.tsx`**

Find the existing import of types at the top of `App.tsx` (line ~18):

```typescript
import { LogisticsRow, InputState, NotificationState, TripStatus, LogisticsTemplate, ...DisplaySettings } from './types';
```

Add `DEFAULT_COLUMN_ORDER` to that import:

```typescript
import { LogisticsRow, InputState, NotificationState, TripStatus, LogisticsTemplate,
         TelegramConfig, AlertSettings, PreviewSettings, DisplaySettings,
         DEFAULT_COLUMN_ORDER } from './types';
```

- [ ] **Step 2: Update the `useState<DisplaySettings>` initializer (~line 92)**

Replace:

```typescript
const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
  density: 'compact',
  tableFontSize: 100,
  borderStyle: 'thin',
  noteHighlightEnabled: true,
  noteHighlightColor: 'amber',
  wrapCells: true,
});
```

With:

```typescript
const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
  density: 'compact',
  tableFontSize: 100,
  borderStyle: 'thin',
  noteHighlightEnabled: true,
  noteHighlightColor: 'amber',
  wrapCells: true,
  columnOrder: DEFAULT_COLUMN_ORDER,
  hiddenColumns: [],
});
```

- [ ] **Step 3: Update the `setDisplaySettings` call in `loadUserData` (~line 152)**

Replace the existing spread line:

```typescript
setDisplaySettings(settings.displaySettings ? { density: 'compact', tableFontSize: 100, borderStyle: 'thin', noteHighlightEnabled: true, noteHighlightColor: 'amber', wrapCells: true, ...settings.displaySettings } : { density: 'compact', tableFontSize: 100, borderStyle: 'thin', noteHighlightEnabled: true, noteHighlightColor: 'amber', wrapCells: true });
```

With:

```typescript
const defaultDisplay: DisplaySettings = {
  density: 'compact',
  tableFontSize: 100,
  borderStyle: 'thin',
  noteHighlightEnabled: true,
  noteHighlightColor: 'amber',
  wrapCells: true,
  columnOrder: DEFAULT_COLUMN_ORDER,
  hiddenColumns: [],
};
setDisplaySettings(settings.displaySettings ? { ...defaultDisplay, ...settings.displaySettings } : defaultDisplay);
```

- [ ] **Step 4: Add new props to the `<TableEditor>` JSX (~lines 778–784)**

Find the `<TableEditor>` block in App.tsx and add two props after `wrapCells`:

```tsx
wrapCells={displaySettings.wrapCells}
columnOrder={displaySettings.columnOrder}
hiddenColumns={displaySettings.hiddenColumns}
```

- [ ] **Step 5: Verify types compile**

```bash
cd /Users/jassar/Projects/Umrah/Umrah-Logistics && npm run lint
```

Expected: TypeScript will complain that `TableEditor` doesn't accept `columnOrder`/`hiddenColumns` yet — that's fine, fix it in Task 3. Or add `// @ts-ignore` temporarily to unblock if preferred, but Task 3 follows immediately.

- [ ] **Step 6: Commit**

```bash
git add App.tsx
git commit -m "feat(app): wire columnOrder and hiddenColumns into displaySettings"
```

---

### Task 3: Update `TableEditor.tsx` to apply column order and visibility

**Files:**
- Modify: `components/TableEditor.tsx`

**Interfaces:**
- Consumes: `DEFAULT_COLUMN_ORDER`, `COLUMN_LABELS` from `../types`
- Consumes: `columnOrder?: string[]`, `hiddenColumns?: string[]` props

- [ ] **Step 1: Import constants in `TableEditor.tsx`**

Find the existing import at the top of `TableEditor.tsx` (line ~8):

```typescript
import { LogisticsRow, TripStatus, LogisticsTemplate } from '../types';
```

Replace with:

```typescript
import { LogisticsRow, TripStatus, LogisticsTemplate, DEFAULT_COLUMN_ORDER, COLUMN_LABELS } from '../types';
```

- [ ] **Step 2: Add `columnOrder` and `hiddenColumns` to `TableEditorProps`**

In the `TableEditorProps` interface (line ~11), add after `wrapCells`:

```typescript
  wrapCells?: boolean;
  columnOrder?: string[];
  hiddenColumns?: string[];
```

- [ ] **Step 3: Destructure the new props in the component function**

In the component destructuring (line ~55), add after `wrapCells = true`:

```typescript
  wrapCells = true,
  columnOrder,
  hiddenColumns,
```

- [ ] **Step 4: Replace the `headers` array with a computed `useMemo`**

Find the current `headers` definition (lines 112–127):

```typescript
const headers: { key: keyof LogisticsRow | 'actions'; label: string }[] = [
    { key: "status", label: "الحالة" },
    { key: "groupNo", label: "رقم م" },
    { key: "groupName", label: "اسم المجموعة" },
    { key: "Column1", label: "الحركة" },
    { key: "tafweej", label: "التفويج" },
    { key: "carType", label: "السيارة" },
    { key: "from", label: "من" },
    { key: "to", label: "إلى" },
    { key: "time", label: "وقت" },
    { key: "flight", label: "رحلة" },
    { key: "date", label: "تاريخ" },
    { key: "count", label: "عدد" },
    ...(isPreview ? [] : [{ key: "notes" as const, label: "" }]),
    ...(isPreview || readOnly ? [] : [{ key: "actions" as const, label: "إجراءات" }])
];
```

Replace it entirely with:

```typescript
const headers = useMemo(() => {
  const order = columnOrder ?? DEFAULT_COLUMN_ORDER;
  const hidden = new Set(hiddenColumns ?? []);
  return order
    .filter(key => !hidden.has(key))
    .filter(key => !(key === 'notes' && isPreview))
    .filter(key => !(key === 'actions' && (isPreview || readOnly)))
    .map(key => ({
      key: key as keyof LogisticsRow | 'actions',
      label: key === 'notes' ? '' : (COLUMN_LABELS[key] ?? key),
    }));
}, [columnOrder, hiddenColumns, isPreview, readOnly]);
```

- [ ] **Step 5: Verify types compile**

```bash
cd /Users/jassar/Projects/Umrah/Umrah-Logistics && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Manual verify**

Start the dev server: `npm run dev`

Open the app. The table should look identical to before (default order, no hidden columns).

- [ ] **Step 7: Commit**

```bash
git add components/TableEditor.tsx
git commit -m "feat(table): apply columnOrder and hiddenColumns from displaySettings"
```

---

### Task 4: Add column manager UI to `Settings.tsx`

**Files:**
- Modify: `components/Settings.tsx`

**Interfaces:**
- Consumes: `COLUMN_LABELS`, `DEFAULT_COLUMN_ORDER` from `../types`
- Consumes: `displaySettings.columnOrder`, `displaySettings.hiddenColumns`
- Calls: `onDisplaySettingsChange({ ...displaySettings, columnOrder: [...] })`
- Calls: `onDisplaySettingsChange({ ...displaySettings, hiddenColumns: [...] })`

- [ ] **Step 1: Add lucide-react imports**

Find the existing lucide import in `Settings.tsx` (line ~2):

```typescript
import {
  ...existing icons...
} from 'lucide-react';
```

Add `Eye`, `EyeOff`, `GripVertical` to it.

- [ ] **Step 2: Import constants from types**

Find the existing types import in `Settings.tsx` (line ~8):

```typescript
import { TelegramConfig, TripStatus, AlertSettings, PreviewSettings, DisplaySettings, NoteHighlightColor } from '../types';
```

Replace with:

```typescript
import { TelegramConfig, TripStatus, AlertSettings, PreviewSettings, DisplaySettings, NoteHighlightColor, COLUMN_LABELS, DEFAULT_COLUMN_ORDER } from '../types';
```

- [ ] **Step 3: Add drag state inside the `Settings` component**

Inside the `Settings` component body (after the existing `const [activePage, ...]` state), add:

```typescript
const [dragIndex, setDragIndex] = useState<number | null>(null);
```

- [ ] **Step 4: Add the column manager section to the Display page**

Find the wrap-cells toggle section in Settings.tsx (around line 433–444):

```tsx
{/* Wrap cells toggle */}
<div className="flex items-center justify-between py-4 border-t border-gray-100">
  ...
</div>

{/* Preview fields + default status */}
<div className="border-t border-gray-100 pt-5 space-y-5">
```

Insert the following **between** the wrap-cells closing `</div>` and the preview-fields `<div>`:

```tsx
{/* Column visibility & order */}
<div className="border-t border-gray-100 pt-5">
  <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">أعمدة الجدول</label>
  <div className="rounded-2xl border border-gray-100 overflow-hidden">
    {(displaySettings.columnOrder ?? DEFAULT_COLUMN_ORDER).map((key, i) => {
      const isHidden = (displaySettings.hiddenColumns ?? []).includes(key);
      const label = COLUMN_LABELS[key] ?? key;
      return (
        <div
          key={key}
          draggable
          onDragStart={() => setDragIndex(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex === null || dragIndex === i) { setDragIndex(null); return; }
            const newOrder = [...(displaySettings.columnOrder ?? DEFAULT_COLUMN_ORDER)];
            const [moved] = newOrder.splice(dragIndex, 1);
            newOrder.splice(i, 0, moved);
            onDisplaySettingsChange({ ...displaySettings, columnOrder: newOrder });
            setDragIndex(null);
          }}
          onDragEnd={() => setDragIndex(null)}
          className={`flex items-center gap-3 px-3 py-2.5 bg-white border-b border-gray-100 last:border-b-0 cursor-grab active:cursor-grabbing transition-colors ${dragIndex === i ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
        >
          <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
          <span className={`flex-1 text-sm ${isHidden ? 'text-gray-300' : 'text-gray-700'}`}>{label}</span>
          <button
            onClick={() => {
              const current = displaySettings.hiddenColumns ?? [];
              const next = isHidden
                ? current.filter(k => k !== key)
                : [...current, key];
              onDisplaySettingsChange({ ...displaySettings, hiddenColumns: next });
            }}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
          >
            {isHidden
              ? <EyeOff size={15} className="text-gray-300" />
              : <Eye size={15} className="text-gray-500" />
            }
          </button>
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 5: Verify types compile**

```bash
cd /Users/jassar/Projects/Umrah/Umrah-Logistics && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Manual verify**

Start the dev server: `npm run dev`

1. Open Settings → Display page.
2. Scroll to the "أعمدة الجدول" section — should see all 14 columns.
3. Click the eye icon on a column — it dims and the eye-off icon appears.
4. Go to the main table — that column should be hidden.
5. Return to Settings, drag a column row to a new position — the list reorders.
6. Go to the main table — column order matches the new order.
7. Reload the page — settings persist (saved to server).

- [ ] **Step 7: Commit**

```bash
git add components/Settings.tsx
git commit -m "feat(settings): add column visibility and ordering controls to display page"
```

---

## Self-Review

**Spec coverage:**
- ✅ All 14 columns are toggleable
- ✅ Drag-to-reorder in settings UI
- ✅ Persisted to server via existing `displaySettings` extra_settings path
- ✅ Native HTML5 drag-and-drop, no new dependency
- ✅ `notes`/`actions` conditional logic preserved in TableEditor
- ✅ Defaults are `columnOrder = DEFAULT_COLUMN_ORDER`, `hiddenColumns = []`
- ✅ Embedded in Display settings page (not a new tab)

**Type consistency:**
- `DEFAULT_COLUMN_ORDER` and `COLUMN_LABELS` defined once in `types.ts`, imported by both `App.tsx`, `TableEditor.tsx`, and `Settings.tsx` — no duplication, no name drift.
- `columnOrder`/`hiddenColumns` names used consistently across all four files.
