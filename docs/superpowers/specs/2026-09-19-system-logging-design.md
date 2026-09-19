# System-Wide Logging with Admin Visibility — Design Spec
**Date:** 2026-09-19
**Status:** Approved

## Problem

`audit_log` (added by the admin dashboard feature) only records account/security events: logins, and admin CRUD on users/companies. Everything else important that happens in the system — data mutations, sharing, settings changes, browser-extension ingest, Telegram alert delivery, and unhandled errors — only goes to `console.log`/`console.error`, which is visible solely in server stdout (PM2 logs on the VPS). There is no way for the admin to see this activity, or to be alerted to failures, from the admin panel.

## Decisions

- **Extend `audit_log`, don't build a parallel system.** Same table, same `/api/admin/audit` endpoint, same Activity tab — widened to cover more event types, plus enough structure (`level`, `category`) to stay usable as volume grows.
- **Scope is data & sharing operations, background jobs/integrations, and errors** — not routine read traffic, and not high-frequency autosave noise. Specifically excluded: `GET` requests, and settings saves that only touch `templates`/`deletedRows`/`notifiedIds`/`fontSize` (these persist on nearly every client action and would flood the log). Telegram config changes ARE logged (security/integration-relevant, low frequency).
- **Sync logging is coarse, not per-row.** `POST /api/data/sync` logs one `data_synced` event per call (with a row count in metadata) when the payload is non-empty, not one event per row — a sync can carry up to 5000 rows.
- **Errors are best-effort, non-blocking, and don't change existing behavior.** A new Express error-handling middleware and `process.on('uncaughtException'/'unhandledRejection')` handlers log to `audit_log` and then behave exactly as they would today (respond 500 / let the process exit on a truly fatal error) — logging must never become a new way for a request or the process to fail differently than it already could.
- **Retention: 90-day auto-prune.** A daily interval (mirroring the existing `checkAndSendAlerts` pattern) deletes `audit_log` rows older than 90 days. No admin-facing retention setting.
- **No per-event-type opt-out UI.** Filtering in the admin panel is by `category`/`level` only.

## Data Model

### `audit_log` (existing table, migrated)

Add two columns, via the existing try/catch `ALTER TABLE` migration pattern already in `server.ts`:
- `level TEXT NOT NULL DEFAULT 'info'` — `'info' | 'warning' | 'error'`.
- `category TEXT NULL` — `'auth' | 'user_mgmt' | 'company_mgmt' | 'data' | 'sharing' | 'settings' | 'integration' | 'system'`.

One-time backfill (`UPDATE audit_log SET category = ... WHERE category IS NULL`) derives category for pre-existing rows from `event_type`'s prefix (`login_*` → `auth`, `user_*` → `user_mgmt`, `company_*` → `company_mgmt`), and sets `login_failure` to `level = 'warning'`.

### New event types

| event_type | category | level | actor / target | metadata |
|---|---|---|---|---|
| `row_updated` | data | info | actor = editor | `{ rowId }` |
| `row_deleted` | data | info | actor = editor | `{ rowId }` |
| `row_restored` | data | info | actor = editor | `{ rowId }` |
| `row_purged` | data | info | actor = owner | `{ rowId }` |
| `rows_purged_bulk` | data | info | actor = owner | `{ count }` (from `DELETE /api/data/deleted`) |
| `bulk_operation` | data | info | actor | `{ action, processedCount, failedCount }` (from `POST /api/data/bulk`) |
| `data_synced` | data | info | actor | `{ rowCount }` — only when `rows.length > 0` |
| `share_invitation_created` | sharing | info | actor = sender, target = receiver | `{ scopeType, rowId/groupNo/agency, role }` |
| `share_invitation_accepted` | sharing | info | actor = receiver, target = sender | `{ scopeType }` |
| `share_invitation_declined` | sharing | info | actor = receiver, target = sender | `{ scopeType }` |
| `share_access_updated` | sharing | info | actor, target = affected user | `{ scopeType, role }` |
| `share_access_revoked` | sharing | info | actor, target = affected user | `{ scopeType }` |
| `telegram_config_updated` | settings | info | actor | none |
| `account_updated` | settings | info | actor | `{ fields: [...changed field names] }` (never the password itself) |
| `ingest_processed` | integration | info | actor | `{ action: 'add'\|'overwrite', groupNo, count }` |
| `ingest_failed` | integration | error | actor | `{ groupNo, message }` |
| `telegram_alert_sent` | integration | info | target = recipient user | `{ rowId }` |
| `telegram_alert_failed` | integration | error | target = recipient user | `{ rowId, reason }` |
| `unhandled_error` | system | error | actor = request user if authenticated | `{ method, path, message }` |
| `process_error` | system | error | none | `{ kind: 'uncaughtException'\|'unhandledRejection', message }` |

The existing `login_failure`/`login_success`/`user_*`/`company_*` insert call sites are switched to go through the same helper (below) for consistency, gaining explicit `category`/`level` instead of relying on the backfill mapping going forward.

## Backend (`server.ts`)

### `logEvent` helper

A single function placed next to the `audit_log` table creation:

```ts
function logEvent(eventType: string, opts: {
  level?: 'info' | 'warning' | 'error';
  category: string;
  actorUserId?: number | null;
  targetUserId?: number | null;
  metadata?: unknown;
}) { ... }
```

Best-effort: wraps its `INSERT` in try/catch and `console.error`s on failure, exactly matching the existing `login_success`/`login_failure` inserts — a logging failure must never surface as a request failure.

### Call sites

Each row in the New event types table above is one `logEvent(...)` call added at its route (after the mutation succeeds, before `res.json(...)`), or — for `ingest_failed`/`telegram_alert_failed`/`telegram_alert_sent` — replacing the existing `console.log`/`console.error` call at that spot rather than adding a second line.

### Error handling (new)

- An Express error-handling middleware (`(err, req, res, next) => {...}`), mounted after every route (right after the SPA catch-all, before the alert-worker section) — none exists today, so an unexpected `throw` inside a route currently falls through to Express's default handler. Logs `unhandled_error`, then sends the same generic 500 JSON error shape already used elsewhere (`{ error: "Server error" }`) if headers aren't already sent.
- `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)` — log `process_error` (synchronous `better-sqlite3` write completes before any exit), plus keep the existing `console.error`. `uncaughtException` still exits after logging (Node's own default behavior today, unchanged); `unhandledRejection` does not exit (matches current behavior, where it merely warns).
- Only mounted outside the Vite dev-middleware branch is unnecessary — applies in all modes including tests, so error-path tests can assert on it directly.

### Retention

A `pruneAuditLog()` function (`DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')`), run once at startup and then on a `setInterval` every 24h, next to the existing `checkAndSendAlerts` scheduling.

### `GET /api/admin/audit`

Add optional query params `category` and `level` (single value each; omit = no filter). Add `level` and `category` to the `SELECT` and the response mapping.

## Frontend (`components/AdminDashboard.tsx`)

- Two new filter `<select>`s above the Activity list (category, level), Arabic-labeled, RTL-consistent with the rest of the dashboard. Changing either re-fetches `/api/admin/audit` with the corresponding query params.
- `EVENT_LABELS` gains an Arabic label for every new `event_type` in the table above.
- Rows with `level: 'warning'` get an amber accent, `level: 'error'` a red accent (border/text color), so failures are visible without opening metadata. `info` rows are styled as they are today.

## Testing

- `tests/server.test.ts`: for each new mutation endpoint (row update/delete/restore/purge, bulk op, sync, share create/accept/decline, share access update/revoke, telegram config save, account update, ingest success/failure), assert the corresponding `audit_log` row appears via `GET /api/admin/audit` with the expected `eventType`/`category`/`level`.
- A test that seeds an old `audit_log` row (`created_at` > 90 days back) and asserts `pruneAuditLog()` removes it while a recent row survives.
- A test that hits a route forced to throw (or the error middleware invoked directly) and asserts a 500 response plus an `unhandled_error` log entry.
- Manual smoke check in the browser: perform a few of the above actions as a regular user, then confirm they appear correctly (label, actor, category/level styling, filters) in the admin Activity tab.
