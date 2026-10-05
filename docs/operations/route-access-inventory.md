# SaaS route and background access inventory

Reviewed against `server.ts` on October 3, 2026. This is the Phase 0 access
contract for the September 30 launch plan; target categories below do not
claim that the current server already enforces workspace/subscription access.

Categories: public, authenticated account, workspace read, workspace write,
workspace owner administration, platform administration. An operational
category always requires an active authenticated membership plus the
subscription policy. A shared row also requires an explicit source-workspace
grant and source/recipient access checks. A platform admin is not implicitly a
customer workspace member. Unknown API routes must return 404.

## API inventory

| Method | Existing path | Target access category | Additional condition / current gap |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | public | Rate limited; Phase 3 introduces revocable sessions/MFA. |
| POST | `/api/auth/refresh` | authenticated account | Refresh credential, not access JWT; rotate/revoke/check account. |
| GET | `/api/admin/overview` | platform administration | Keep detailed system/account information private. |
| GET | `/api/admin/health` | platform administration | Keep detailed system/database information private. |
| GET | `/api/admin/audit` | platform administration | Minimize metadata; approved retention required. |
| GET | `/api/admin/users` | platform administration | Separate platform roles from customer memberships. |
| POST | `/api/admin/users` | platform administration | Future membership/invitation seat checks; customer-chosen passwords. |
| PATCH | `/api/admin/users/:id` | platform administration | Disable revokes sessions/live access; company label cannot transfer ownership. |
| POST | `/api/admin/users/:id/reset-password` | platform administration | Recent verification and revoke all sessions in Phase 3. |
| DELETE | `/api/admin/users/:id` | platform administration | Current handler refuses deletion while creator trips exist; preserve that protection and use disabled memberships for company offboarding. |
| GET | `/api/admin/companies` | platform administration | Company IDs become authoritative workspace identities only after review. |
| POST | `/api/admin/companies` | platform administration | Provision pending workspace without operational access. |
| PATCH | `/api/admin/companies/:id` | platform administration | Renaming must not change ownership or grants. |
| DELETE | `/api/admin/companies/:id` | platform administration | Replace with verified lifecycle workflow; no implicit trip deletion. |
| GET | `/api/data` | workspace read | Authorized own/shared rows; filter in SQL. Frontend analytics/export use this payload. |
| GET | `/api/data/deleted` | workspace read | Same source/grant checks for recycle-bin rows. |
| POST | `/api/data/sync` | workspace write | Authorize every row and inferred deletion; stale/shared data cannot broaden scope. |
| PATCH | `/api/data/:id` | workspace write | Row owner workspace or explicit editor grant; preserve version conflict checks. |
| POST | `/api/data/:id/delete` | workspace write | Scoped soft delete; viewer cannot mutate. |
| POST | `/api/data/:id/restore` | workspace write | Same checks for deleted rows. |
| DELETE | `/api/data/deleted` | workspace write | Bulk purge only authorized deleted rows; retain stricter owner purge semantics pending reviewed workspace-role policy. |
| DELETE | `/api/data/:id` | workspace write | Current purge is creator-only and requires soft deletion first; do not broaden to shared editors during migration. |
| POST | `/api/data/bulk` | workspace write | Per-row authorization; incoming workspace/creator IDs are not authority. |
| POST | `/api/shares/invitations` | workspace owner administration | Source membership + permitted sharing role; source ID compulsory. Role delegation needs review. |
| GET | `/api/shares/invitations` | authenticated account | Only addressed invitations; redact operational scope until read access permits it. |
| POST | `/api/shares/invitations/:id/accept` | workspace write | Recipient identity, active membership, source authority, both subscriptions; recheck at acceptance. |
| POST | `/api/shares/invitations/:id/decline` | authenticated account | Only addressed invitation; usable even with expired/suspended operational access. |
| GET | `/api/shares/access` | workspace owner administration | Source-scoped grant administration; never enumerate foreign trips. |
| PATCH | `/api/shares/access` | workspace owner administration | Recheck source authority; scope cannot be established by group/agency label alone. |
| DELETE | `/api/shares/access` | workspace owner administration | Revoke source-scoped grant; close/recheck affected live access immediately. |
| GET | `/api/settings` | authenticated account + workspace read | Split personal preferences from workspace integration settings; restrict credential disclosure. |
| POST | `/api/settings` | authenticated account + workspace owner administration | Personal font/display/preview saves use account access; integration/templates/alerts require workspace administration. Legacy trash is operational data. |
| GET | `/api/account` | authenticated account | Own account only; available for recovery/contact despite subscription restrictions. |
| PATCH | `/api/account` | authenticated account | Current-password proof for credentials; changing profile label never changes membership. |
| POST | `/api/telegram/test` | workspace owner administration | Authorized configured integration + permitted subscription; sends an external message. |
| GET | `/api/alerts/debug` | workspace read | Current handler is per-user; future customer diagnostics must remain workspace scoped. Global tools require platform admin. |
| POST | `/api/alerts/trigger` | platform administration | Current handler lets any authenticated user trigger every user's worker. Restrict global trigger; future customer trigger must be scoped separately. |
| GET | `/api/check/group/:groupNo` | workspace read | Count only authorized live rows; never reveal foreign/deleted counts. |
| POST | `/api/ingest/text` | workspace write | Extension is subject to identical membership/subscription checks, including overwrite. |
| GET | `/api/extension/info` | public | Version/package metadata only, no workspace/secret information. |
| GET | `/api/download/extension` | public | Fixed package path; no arbitrary file download. |
| GET | `/api/__test/throw` | authenticated account | Registered only in test environment; must remain absent from deployment. |

`/api/auth/register` is absent (404). No analytics/export API currently exists;
the frontend calculates analytics and exports from authorized `/api/data`
results. Phase 4 adds a separate owner-authorized full workspace export.
Settings is deliberately listed with two categories: a mixed request must
check every field before writing anything. Read-only expiry permits personal
preferences but cannot permit workspace changes through this mixed endpoint.

## Browser, static and live surfaces

| Method/surface | Path | Target access category | Condition |
| --- | --- | --- | --- |
| GET | `/`, `/home`, `/about`, `/contact`, `/security`, `/terms`, `/cookies`, `/privacy` | public | Marketing and customer policies. |
| GET | `/home.html`, `/about.html`, `/contact.html`, `/security.html`, `/terms.html`, `/cookies.html`, `/privacy.html` | public | Fixed redirects to clean paths. |
| GET | `/privacy.css` | public | Fixed CSS file. |
| GET | `/login` | public | React shell; server API remains the access boundary. |
| Static/dev middleware | Vite middleware; production `dist/` assets | public | Assets contain no secrets/customer data. |
| GET | `/{*splat}` (production/staging) | public | React shell fallback currently also catches unknown API GETs; future unknown API paths must return 404. |
| WebSocket upgrade | `/api/live` | workspace read | Future single-use connection ticket; recheck session, active membership and access on connection/events. |
| WebSocket delivery | `rows_changed`, `invitations_changed` | workspace read / authenticated account | Row changes only to authorized source/recipient members; invitation notices only to participants without trip payload. |

## Background and operator actions

| Action | Target access category | Required checks |
| --- | --- | --- |
| `checkAndSendAlerts` (startup, 60-second schedule and manual trigger) | workspace write | Active/grace subscription, authorized integration, current members; source-owned live rows only; skip deleted rows; durable deduplication; one scheduler. Current worker reads each creator's rows and does not filter deleted/inactive accounts. |
| Alert notification-state writes | workspace write | Workspace job owns deduplication state; clients cannot erase it. |
| `pruneAuditLog` (startup and daily) | platform administration | Approved audit-retention schedule; preserve justified security history. |
| Admin bootstrap | platform administration | Explicit secure bootstrap configuration; no automatic customer ownership. |
| Schema initialization/ad hoc migrations | platform administration | Replace with numbered transactional migrations; approved mapping, verified snapshot and rehearsed rollback. |
| `scripts/workspace-readiness.mjs` | platform administration (operator CLI) | Explicit existing database path, read-only transaction, identifier-only output, no server import/outbound jobs. |
| `scripts/db-backup.mjs` backup/restore | platform administration (operator CLI) | Verified snapshot; safe restore requires stopped workers/app, replay deletion tombstones and invalidate restored sessions. |
| Extension packaging and release workflow | platform administration (operator tooling) | Tests/artifact/version checks; release preparation before switch. |

Future routes/jobs must be added here when implemented: subscriptions, member
invitations, verified recovery, sessions, MFA, workspace export/deletion,
health probes and notification outbox. This inventory assigns target
categories; phase-specific tests must prove enforcement on HTTP, WebSocket,
extension and background entry points.
