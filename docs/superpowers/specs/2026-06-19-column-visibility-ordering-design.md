# Column Visibility & Ordering — Design Spec

**Date:** 2026-06-19  
**Status:** Approved

## Goal

Allow users to show/hide individual table columns and reorder them, with preferences saved per-user to the server.

## Scope

All 14 columns are user-controllable:

| Key | Label |
|---|---|
| `status` | الحالة |
| `groupNo` | رقم م |
| `groupName` | اسم المجموعة |
| `Column1` | الحركة |
| `tafweej` | التفويج |
| `carType` | السيارة |
| `from` | من |
| `to` | إلى |
| `time` | وقت |
| `flight` | رحلة |
| `date` | تاريخ |
| `count` | عدد |
| `notes` | الملاحظات |
| `actions` | إجراءات |

No columns are locked — any column can be hidden or reordered.

## Data Model

Add two fields to `DisplaySettings` in `types.ts`:

```typescript
columnOrder: string[];   // ordered array of column keys; default = canonical order above
hiddenColumns: string[]; // keys of hidden columns; default = []
```

Persisted via the existing `extra_settings` SQLite column through the `displaySettings` save/load path. No server schema changes needed.

**Default values** (added to App.tsx load fallback):
```typescript
columnOrder: ['status','groupNo','groupName','Column1','tafweej','carType','from','to','time','flight','date','count','notes','actions'],
hiddenColumns: [],
```

## Settings UI

### Placement
New section added to the **Display** settings page (`Settings.tsx`), inserted **after** the wrap-cells toggle and **before** the preview-fields section.

### Section: أعمدة الجدول (Table Columns)

A vertical draggable list of all 14 columns. Each row contains:
- **Right side:** drag handle icon (≡) — active drag target
- **Middle:** Arabic column label
- **Left side:** eye / eye-off icon button — toggles visibility

The list order reflects `columnOrder`. Dragging a row reorders it and updates `columnOrder`. Clicking the eye button adds/removes the key from `hiddenColumns`.

### Drag implementation
Native HTML5 drag-and-drop (`draggable`, `onDragStart`, `onDragOver`, `onDrop`) — no new dependency. A local `dragIndex` ref tracks the item being dragged. On drop, the `columnOrder` array is spliced and `onDisplaySettingsChange` is called.

### Visual design
Consistent with the existing display settings style: `bg-gray-50 rounded-2xl` card, rows separated by `border-b border-gray-100`. Hidden rows use `text-gray-300` label + filled eye-off icon. Active drag target gets a subtle `bg-blue-50` highlight.

## TableEditor Changes

In `TableEditor.tsx`, the `headers` array (lines 112–126) is currently hardcoded. It will be rebuilt each render by:

1. **Start from `columnOrder`** — map keys to their `{ key, label }` header objects.
2. **Filter hidden columns** — remove any key present in `hiddenColumns`.
3. **Preserve existing conditional logic** — `notes` and `actions` are still excluded when `isPreview` or `readOnly` is true, applied after the user's visibility filter.

`TableEditor` already receives `displaySettings` as a prop, so no prop signature change is needed.

## App.tsx Changes

In the `displaySettings` load fallback (where defaults are applied after loading from server), add:

```typescript
columnOrder: loaded.columnOrder ?? DEFAULT_COLUMN_ORDER,
hiddenColumns: loaded.hiddenColumns ?? [],
```

Where `DEFAULT_COLUMN_ORDER` is the canonical array defined as a constant.

## What is NOT in scope

- Column resizing (width adjustment)
- Column reordering by dragging table headers directly
- Per-view or per-group column presets
- Exporting with only visible columns
