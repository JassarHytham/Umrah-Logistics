# Admin Dashboard & Super-Admin Role — Design Spec
**Date:** 2026-09-18
**Status:** Approved

## Problem

Any visitor can currently self-register an account from the login page (`POST /api/auth/register`, wired to the "create account" toggle in `Auth.tsx`). There is no way to see or manage the resulting accounts: no account-level role, no way to group users by company, no way for an operator to reset a forgotten password, disable an account, or see recent account/security activity.

The owner needs a single super-admin account, separate from the operational (trip-logistics) UI, that can:
- Create/manage regular user accounts (self-signup is being removed).
- Group users into companies (a label, not a data-visibility boundary).
- Reset a user's password directly.
- Disable or permanently delete a user.
- See recent account/security activity (logins, password resets, account and company changes).

## Decisions

- **Company is a label only.** A real `companies` table exists for admin-side grouping/filtering, but it has no effect on the existing row-sharing/access-control system (`getRowAccessForUser`, the `trip_row_access` / `trip_group_access` / `trip_agency_access` tables, and the free-text `agency` tag on trip rows). That system is untouched by this feature.
- **Single admin account.** Exactly one super-admin, seeded once at server startup from `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars if no `role = 'admin'` row exists yet. No multi-admin invite flow, no admin-management UI for admins themselves.
- **Self-signup is removed entirely.** `POST /api/auth/register` is deleted. All new regular-user accounts are created by the admin from the dashboard (username, password, optional company — no email field, since nothing sends email today).
- **Password reset is direct.** The admin types a new password for a user and it's active immediately. No temp-password/forced-change flow.
- **Account & security activity only** is tracked (not full trip-data change history): logins (success and failure), account creation, password resets, enable/disable, deletion, company created/renamed/deleted. Capped to the most recent 200 events, no pagination UI.
- **User removal supports both disable and hard delete.** Disabling sets `is_active = 0` (blocks login, keeps all data). Hard-deleting a user is refused with a 400 if they still own any `logistics_rows`. This dashboard does not add a way for the admin to reassign, browse, or bulk-clear another user's rows (that stays scoped to the owning account via the existing `/api/data` routes, unchanged by this feature) — so in practice a user with existing trips gets disabled, not deleted, unless they clear their own data first.
- **Company deletion is refused if any user is still assigned to it**, for the same reason.
- **No router.** The app has no `react-router`; role-based routing branches at the top of `App.tsx`'s render, matching the existing `if (!user) return <Auth />` pattern.

## Data Model

### `users` (existing table, migrated)

Add:
- `role TEXT NOT NULL DEFAULT 'user'` — `'user'` or `'admin'`.
- `is_active INTEGER NOT NULL DEFAULT 1`
- `company_id INTEGER NULL` — FK to `companies.id`.
- `last_login_at DATETIME NULL`

Follows the existing migration pattern in `server.ts` (`try { SELECT <col> FROM users LIMIT 1 } catch { ALTER TABLE ... ADD COLUMN ... }`).

### `companies` (new)

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `name TEXT UNIQUE NOT NULL`
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`

### `audit_log` (new)

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `event_type TEXT NOT NULL` — one of: `login_success`, `login_failure`, `user_created`, `user_password_reset`, `user_disabled`, `user_enabled`, `user_deleted`, `company_created`, `company_renamed`, `company_deleted`.
- `actor_user_id INTEGER NULL` — who performed the action; `NULL` for e.g. a failed login with an unknown/invalid username.
- `target_user_id INTEGER NULL` — the user the event is about, where applicable.
- `metadata TEXT NULL` — small JSON blob for event-specific context (e.g. `{"username": "..."}` on a failed login).
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`

### Admin bootstrap

On server startup, after migrations run: if `SELECT 1 FROM users WHERE role = 'admin'` returns nothing, read `ADMIN_USERNAME` / `ADMIN_PASSWORD` from env. If both are present and valid (same validation as regular usernames/passwords), bcrypt-hash and insert a `role = 'admin'` user. If missing, log a clear startup warning (do not crash the server — an existing deployment without these env vars should still boot).

## Backend (`server.ts`)

### Auth changes

- `authenticateToken` already re-queries the DB every request to catch a deleted user (see the existing `stillExists` check). Extend that same query to `SELECT id, role, is_active FROM users WHERE id = ?` and attach fresh `role`/`is_active` onto `req.user`. If `is_active` is falsy, respond `401` — this means disabling a user kills their session on their very next request, and a demoted admin loses `/api/admin/*` access immediately, with no stale-JWT window.
- `POST /api/auth/login`: reject with `401` if `is_active = 0` (same generic "Invalid credentials" message, to avoid leaking account status). On success, update `last_login_at` and insert an `audit_log` row (`login_success`, `actor_user_id` = the user). On failure (bad username or password), insert an `audit_log` row (`login_failure`, `actor_user_id = NULL`, `metadata = {"username": <normalized input>}`).
- `POST /api/auth/register` is deleted.
- JWT payload and `authResponse` gain `role` (and the frontend gets `user.role`).
- New `requireAdmin` middleware, applied after `authenticateToken`, checking `req.user.role === 'admin'` (403 otherwise).

### New routes, all under `/api/admin`, all gated by `authenticateToken` + `requireAdmin`

- `GET /api/admin/overview` — counts for the dashboard landing view: total users, active users, total companies, total trip rows.
- `GET /api/admin/users` — list all users, joined with company name: `id, username, role, is_active, company_id, company_name, created_at, last_login_at`.
- `POST /api/admin/users` — create `{ username, password, company_id? }`. Same username/password validation as the old register endpoint. Writes `user_created` to the audit log.
- `PATCH /api/admin/users/:id` — update `{ company_id?, is_active? }`. Toggling `is_active` writes `user_disabled` or `user_enabled`.
- `POST /api/admin/users/:id/reset-password` — `{ password }`, bcrypt-hash and overwrite. Writes `user_password_reset`.
- `DELETE /api/admin/users/:id` — hard delete. `400` if `SELECT 1 FROM logistics_rows WHERE user_id = ? LIMIT 1` finds any row. Also refuses deleting the admin's own account (`400`, to avoid ever locking yourself out). Writes `user_deleted`.
- `GET /api/admin/companies` — list with a user count per company.
- `POST /api/admin/companies` — `{ name }`. Writes `company_created`.
- `PATCH /api/admin/companies/:id` — `{ name }`. Writes `company_renamed`.
- `DELETE /api/admin/companies/:id` — `400` if any user has that `company_id`. Writes `company_deleted`.
- `GET /api/admin/audit` — most recent 200 `audit_log` rows, newest first, joined to actor/target usernames where present.

## Frontend

- **`components/Auth.tsx`**: remove `isLogin` state, the register branch of `handleSubmit`, and the toggle button/link entirely. Pure login form.
- **`App.tsx`**: immediately after the existing `if (!user) return <Auth onLogin={...} />;`, add `if (user.role === 'admin') return <AdminDashboard user={user} onLogout={...} onUserUpdate={...} />;`. Everything below (the operational data-grid UI) is unchanged and is never reached by the admin account.
- **New `components/AdminDashboard.tsx`**: a self-contained page (own header reusing the existing logo/title/logout pattern from `App.tsx`'s header for visual consistency) with three sections — **Users**, **Companies**, **Activity** — plus the overview counts at the top. Users and Companies sections have create/edit forms and confirm-dialogs for disable/delete, styled with the existing gold/navy Tailwind classes already used across the app. No new dependencies (no table/grid library) — plain lists/tables consistent with `TableEditor.tsx`'s existing patterns.
- **`services/api.ts`**: replace the `auth.register` method with an `admin` namespace mirroring the new endpoints (`overview`, `listUsers`, `createUser`, `updateUser`, `resetPassword`, `deleteUser`, `listCompanies`, `createCompany`, `updateCompany`, `deleteCompany`, `listAuditLog`), following the existing `api.request` + Bearer-token pattern.
- **`types.ts`**: add `role`, `companyId`, `isActive` (as relevant) to the `User`-shaped type used by `App.tsx`/`Auth.tsx`, and new `Company` / `AuditLogEntry` types for the admin dashboard.

## Testing

`tests/server.test.ts` and `tests/consistency.test.ts` currently use `POST /api/auth/register` as their user-bootstrap helper (~15 call sites). Since that endpoint is removed:
- Test setup seeds (or logs in as) the admin account — either via the same `ADMIN_USERNAME`/`ADMIN_PASSWORD` env-var bootstrap the server uses, or a direct DB insert in a `beforeAll`/test-setup hook, whichever fits the existing test harness with the least churn.
- A shared test helper logs in as admin and calls `POST /api/admin/users` to create each test user, then logs in as that user to get its token, preserving the existing call shape (`{ token, user }`) test bodies already assert on.
- New tests are added for: admin-only route protection (403 for non-admin/no token), user create/list/reset-password/disable/delete (including the "delete blocked by owned rows" and "can't delete self" cases), company create/rename/delete (including "delete blocked by assigned users"), the audit log recording the events above, and disabled-user login/API rejection.

## Out of scope (explicitly, for YAGNI)

- Multiple admin accounts / admin invite flow.
- Email on user accounts, or any email-sending (invites, password-reset links).
- Full trip-data change history in the audit log (only account/security events).
- Company as a real multi-tenancy/data-visibility boundary.
- Pagination UI for users/companies/audit lists (current expected scale doesn't need it; revisit if it does).
- Forced password-change-on-next-login flow.
