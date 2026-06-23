# Agency Column — Design Spec
**Date:** 2026-06-23
**Status:** Approved

## Problem

The logistics table needs a new column for the travel agency / main agent attached to each Nusuk group. The value is visible in the Nusuk groups table under `اسم الوكيل الرئيسي`; in the DOM it is the row cell `td[id="eaName"]`. The local app should show this value as `الوكيل`.

The field must behave like existing group metadata:

- captured by the Chrome extension together with group number, group name, and pilgrim count;
- copied into every trip row extracted from the itinerary text;
- shared between accounts whenever those trip rows are visible through row or group sharing;
- editable, filterable, sortable, importable, and exportable in the app table.

## Decision

Add a row JSON field named `agency` and display it with the Arabic label `الوكيل`.

The app already stores trip rows as JSON in `logistics_rows.data`. Sharing logic grants access to canonical rows and returns the whole row payload, so a new JSON field automatically flows to shared accounts without adding a SQL column or share-table migration.

## Data Model

Extend `LogisticsRow`:

```ts
agency: string;
```

Extend `GroupInfo`:

```ts
agency?: string;
```

`agency` is optional in inbound group metadata so older extension versions and manual flows remain compatible. Newly created app rows should use an empty string.

## Parser Behavior

`parseItineraryText(text, groupInfo)` already spreads `groupInfo` into every generated row. After `GroupInfo` includes `agency`, all arrival, inter-city, departure, and fallback rows will carry the agency value with no separate parsing logic.

Example:

```ts
parseItineraryText(text, {
  groupNo: "480900139756",
  groupName: "Amirah July Grp 1",
  count: "6",
  agency: "اميرة ترافيل",
});
```

Every returned row includes:

```ts
agency: "اميرة ترافيل"
```

## App Table

Add `agency` to the default table column order near group metadata:

```ts
status, groupNo, groupName, agency, Column1, ...
```

Add the label:

```ts
agency: "الوكيل"
```

The existing `TableEditor` dynamic column rendering will handle filtering, sorting, inline editing, hidden columns, and display settings once the field is in `DEFAULT_COLUMN_ORDER` and `COLUMN_LABELS`.

## Manual Input

The manual trip input panel should include an optional `الوكيل` input next to group number, group name, and count. Manual extraction passes `agency` through `parseItineraryText`.

The field is optional because older workflows and some imported sheets may not have agency data.

## Import And Export

Excel export should include:

```ts
"الوكيل": row.agency
```

Excel import should read agency from these headers:

```ts
["الوكيل", "اسم الوكيل الرئيسي", "Agency", "Main Agent", "اسم_الوكيل_الرئيسي"]
```

JSON backup import already preserves arbitrary row fields, so it only needs no-op compatibility.

## Chrome Extension

The extension group-row capture should extract:

```js
agency: cellText(row.querySelector('td[id="eaName"]'))
```

It should persist the field anywhere group metadata is stored:

- `umrah_autofill`
- `umrah_active_group`
- `umrah_last_group`

Both manual popup sending and auto-capture background sending should include `agency` in the `/api/ingest/text` request body.

The auto-capture badge can continue to show group name and group number only; agency display in the badge is not required for this feature.

## Backend Ingest

Extend `/api/ingest/text` to accept optional `agency`:

```json
{
  "text": "...",
  "groupNo": "480900139756",
  "groupName": "Amirah July Grp 1",
  "count": "6",
  "agency": "اميرة ترافيل"
}
```

The endpoint trims `agency` and passes it to `parseItineraryText`. Missing agency becomes an empty string.

No database migration is required.

## Testing

Add focused tests:

- parser propagates `agency` into every generated row;
- table constants expose `agency` with label `الوكيل`;
- extension row helper captures `eaName` as `agency`;
- server ingest stores `agency` on rows returned from `/api/ingest/text`;
- final TypeScript lint passes.

