# Annual SaaS Launch Readiness Implementation Plan

> **For implementation:** Use the executing-plans workflow to complete this document task by task. Check off deliverables only when their acceptance criteria are met. This document authorizes planning; it does not record implementation as completed.

**Goal:** Prepare UM Track for agencies using annual company subscriptions, with safe data boundaries, reliable operations, and subscriptions managed by contacting the UM Track team.

**Architecture:** Keep React, Express, and SQLite for the initial launch. Make each company a workspace that owns operational data, memberships, and its subscription. Extract focused authorization, subscription, session, migration, and background-job modules as those responsibilities change; keep unrelated application behavior intact.

**Tech stack:** React 19, TypeScript, Express 5, better-sqlite3, JWT, bcrypt, WebSocket, Vitest/Supertest, GitHub Actions, PM2, and the existing Chrome extension.

**Requirements source:** The launch assessment in this conversation and the user's instruction to document all recommended work, excluding tax/pricing work and in-app payments.

**Date:** September 30, 2026.

## 1. Scope and working assumptions

### Confirmed requirements

- Annual subscriptions are arranged through direct contact with the team.
- Account activation and renewal are administered by the team.
- There are no in-app payments, checkout, payment-provider integrations, automatic charges, or payment webhooks.
- Tax, invoicing compliance, subscription prices, monetary records, and pricing calculations are outside this implementation plan.
- Cover company isolation, sharing, subscription access, seats, recovery, security, backups, deployment, monitoring, customer policies, onboarding, extension reliability, support, and pilot validation.
- Preserve existing trip editing, parsing, analytics, import/export, alerts, recycle bin, and intentional sharing.

### Proposed defaults for implementation

These are recommendations to review before the affected phase is implemented, rather than established business policies:

| Decision | Proposed default |
| --- | --- |
| Subscription unit | One annual subscription per company workspace |
| Membership | One workspace per customer account initially; platform admins remain separate |
| Term | One calendar year from an explicitly recorded start timestamp |
| Renewal | Manual renewal after the team confirms the external arrangement |
| Seat allowance | A positive integer set by the platform admin for each workspace |
| Renewal reminders | 30, 14, and 7 days before expiry; expiry and grace-end notices |
| Grace period | 7 days after the term ends |
| After grace | Read-only access, export, account recovery, and contact support |
| Cancellation | Stops future renewal; access continues to the recorded end of the term |
| Security suspension | Blocks operational access immediately, independent of expiry |
| Retention after expiry | 90 days, followed by a reviewed deletion process and prior notices |
| Backup retention | Hourly local copies for 7 days; daily off-server copies for 30 days |
| Recovery objectives | At most 1 hour of data loss and restoration within 4 hours |
| Support | Acknowledge normal requests within one business day; define a staffed urgent incident route before launch |

Record approved policy values in workspace configuration and published customer terms. The system must not send notices or erase data based on an unapproved policy.

## 2. Current foundations and identified gaps

Repository inspection found:

- Admin users/companies, account disabling, viewer/editor sharing, audit events, server-side Telegram alerts, and admin health information already exist.
- `users.company_id` and `companies` currently group accounts for administration; they are explicitly not used as data access boundaries.
- Trips belong to individual users. Group/agency grants are keyed by group number or agency name, without an owning company boundary.
- Access and refresh JWTs exist, but password reset does not revoke issued sessions. The web client stores access tokens in localStorage and does not currently use the refresh response.
- The login screen is for provisioned accounts. An account-recovery flow and platform-admin MFA need to be added.
- Sensitive-setting encryption is optional if `SETTINGS_ENCRYPTION_KEY` is missing, while public security/privacy pages describe encryption as an existing guarantee.
- SQLite backup/restore tooling and deployment-installed hourly backup cron exist. The documented backup destination is on the same VPS, and cron setup is skipped for non-root deploy users.
- Deployment stops PM2 before dependency installation and frontend build; failures can extend downtime. The workflow does not run the existing test/type-check commands before deployment.
- Public legal and contact pages already exist, but annual access, renewal, cancellation, and expiry behavior need concrete policies.
- `package.json` and `tests/` include a test suite, despite the older AGENTS.md description saying no runner is configured.

These observations describe source code, not verified production configuration or a completed security audit.

## 3. Delivery order and dependencies

| Phase | Deliverable | Depends on | Launch importance |
| --- | --- | --- | --- |
| 0 | Agreed policy, route inventory, migration mapping | None | Required foundation |
| 1 | Workspace ownership and safe sharing | Phase 0 | Critical blocker |
| 2 | Manual annual subscription and seat enforcement | Phase 1 | Required |
| 3 | Session revocation, recovery, and admin MFA | Phase 1 | Required |
| 4 | Enforced secrets and customer data lifecycle | Phases 1–3 | Required |
| 5 | Off-server backup and recovery drill | Phase 4 | Required |
| 6 | Safe release workflow and external monitoring | Phases 1–5 | Required |
| 7 | Customer onboarding, extension support, and policies | Phases 1–6 | Required |
| 8 | Agency pilot and launch decision | Phases 0–7 | Final launch gate |

Operational documentation can be drafted while engineering phases progress. Public promises must reflect the finished, verified service.

## 4. File and responsibility map

Paths below are implementation targets; new paths are proposals, not files that already exist.

| Existing path | Planned responsibility/change |
| --- | --- |
| `server.ts` | Integrate workspace context, policy checks, secure sessions, admin endpoints, job authorization, and health endpoints |
| `types.ts` | Workspace, membership, subscription, access, session, and support-facing types |
| `services/api.ts` | Workspace/subscription responses, renewal contact actions, session/recovery endpoints, structured access errors |
| `App.tsx` | Workspace context, subscription notices, read-only state, session expiry, and safe live-update handling |
| `components/AdminDashboard.tsx` | Memberships, activation/renewal, seat management, audit history, and suspension |
| `components/Auth.tsx`, `components/Profile.tsx` | Recovery, MFA prompt, session management, and verified account identity |
| `components/Settings.tsx`, `components/TableEditor.tsx` | Workspace settings, scoped sharing, role and subscription restrictions |
| `components/OperationsIntelligence.tsx` | Consume only authorized workspace analytics |
| `scripts/db-backup.mjs` | Verified backup/restore operations and recovery safeguards |
| `.github/workflows/deploy.yml` | Checks, prepared releases, safe migration, health verification, rollback |
| `.env.example`, `README.md`, `AGENTS.md` | Actual setup, commands, security requirements, and operating guidance |
| `public/home.html`, `public/terms.html`, `public/privacy.html`, `public/security.html`, `public/contact.html`, `public/cookies.html` | Contact-led subscriptions, approved policies, accurate technical claims |
| `chrome extention/umrah-extension/` | Scoped session/access handling, capture permissions, and update/fallback experience |
| `scripts/package-extension.mjs` | Reproducible versioned extension package |
| `tests/` and extension `test/` | Isolation, subscription, recovery, migration, deployment, and integration regression coverage |

Create focused modules under `server/` for `workspaces.ts`, `access.ts`, `subscriptions.ts`, `sessions.ts`, `recovery.ts`, `mfa.ts`, `notifications.ts`, and `migrations.ts`. Add `components/SubscriptionStatus.tsx` and `components/WorkspaceMembers.tsx` for the two customer-facing concerns. Create operating guides under `docs/operations/` and customer guides under `docs/customer/`.

## 5. Phase 0 — Define the operating rules and migration scope

**Owner:** Product owner and implementing engineer.

- [ ] Approve the defaults in section 1, including seat counting, grace access, retention, and annual date handling.
- [x] Make a route inventory covering data, deleted data, sharing, account, settings, admin, Telegram, alerts, ingestion, duplicate checks, downloads, and WebSocket connections. See `docs/operations/route-access-inventory.md` (October 3, 2026).
- [x] Assign every route an access category: public, authenticated account, workspace read, workspace write, workspace owner administration, or platform administration. Categories are documented targets; enforcement is implemented in the owning phases.
- [ ] Map each current customer account to a workspace and identify each workspace owner. Do not assume matching company display names establish ownership.
- [ ] Inventory existing shared trips and decide which represent intentional collaboration between companies.
- [ ] Define the company ownership transfer process, support identity-verification procedure, and approved support channels.
- [ ] Document the workspace migration mapping without passwords, tokens, bot credentials, or trip personal data.

**Acceptance:** Every existing customer and trip has a reviewed ownership destination; every API and background action has an access category; policy choices are recorded before code changes rely on them.

## 6. Phase 1 — Establish workspace ownership and fix sharing

**Staging execution note (October 5, 2026):** Checked engineering items below
are implemented behind the staging-only workspace gate. Production mappings,
conflict-resolution approvals and subscription policies remain open. See
`docs/operations/staging-workspace-rollout.md` for trial choices and rollback.
The user approved assigning the five orphan trips to a new staging testing
company. Activation now proceeds through a count-guarded, history-preserving
migration. Checked items denote code/tests; live deployment verification is
recorded separately and does not mean the entire SaaS launch is complete.

**Files:** `server.ts`, `types.ts`, `server/workspaces.ts`, `server/access.ts`, `server/migrations.ts`, `App.tsx`, `components/Settings.tsx`, `components/AdminDashboard.tsx`, and new `tests/workspaceIsolation.test.ts` / `tests/workspaceMigration.test.ts`.

### Task 1.1: Introduce workspace ownership

- [x] Promote the existing company records to workspace identities; keep account profile labels separate from authoritative workspace identity.
- [x] Add memberships with `(workspace_id, user_id)` uniqueness and roles `owner`, `manager`, `editor`, and `viewer`. Keep platform administrator status outside these customer roles.
- [x] Add `workspace_id` to trips. Preserve creator identity for history, rather than using creator identity as the company ownership boundary.
- [ ] Separate workspace settings such as Telegram configuration/templates from personal display preferences. Record a reviewed choice where existing members have conflicting integration settings.
- [x] Resolve workspace identity from authenticated membership; reject a workspace ID supplied by a client when membership does not permit it.
- [x] Enable and verify SQLite foreign-key enforcement, and add indexes for workspace trip listing and membership lookup.
- [x] Apply workspace filters in SQL before loading rows; remove full-database row scans from ordinary workspace listing.

### Task 1.2: Repair sharing boundaries

- [x] Replace globally keyed group/agency grants with `(source_workspace_id, scope_value, recipient_user_id)` scoped grants. Use source workspace IDs in invitations and accepted access records.
- [x] A row grant must reference the row's owning workspace; a group/agency grant must match both owning workspace and value.
- [x] Preserve intentional cross-company collaboration through explicit source-workspace grants. A recipient's own workspace must never acquire ownership of externally shared trips.
- [ ] Authorize recipients individually and require an active recipient membership. Sharing cannot bypass either workspace's subscription restrictions.
- [ ] Permit recipient edits only when the explicit sharing role allows them and both source and recipient workspace write policies allow them.
- [x] Apply the same rules to analytics, deleted rows, restore/purge, duplicate checks, bulk sync, imports, and WebSocket event recipients.
- [x] Drop or reauthorize grants whose source workspace cannot be established safely; do not infer a source from a matching group/agency name.
- [x] Recheck invitations on acceptance so revoked membership or removed authority cannot create access later.

### Task 1.3: Migrate without losing customer data

- [x] Introduce numbered, transactional migrations with a recorded schema version instead of adding further ad hoc migration blocks.
- [x] Produce a dry-run report of workspace mappings, trip counts, orphan records, and ambiguous grants.
- [ ] Rehearse against a protected copy of existing data, compare counts, and verify ownership/sharing before production migration.
- [x] Retain disabled employee memberships for audit history; offboarding must leave company trips intact.
- [x] Take a verified pre-migration snapshot and document the matching application/database rollback procedure.

**Acceptance scenarios:** Companies A and B both use group `100` and agency `Example`. Sharing from A exposes only A's authorized rows. B's trip IDs cannot be read, changed, restored, purged, or inferred through duplicate checks. A's events never reach B unless an explicit grant permits them. Removing an employee preserves trips and immediately ends that employee's access. Migration produces no unexplained loss or broadened grants.

## 7. Phase 2 — Implement contact-managed annual subscriptions

**Files:** `server/subscriptions.ts`, `server/access.ts`, `server.ts`, `types.ts`, `services/api.ts`, `components/AdminDashboard.tsx`, `components/SubscriptionStatus.tsx`, `components/WorkspaceMembers.tsx`, `App.tsx`, and `tests/subscriptions.test.ts` / `tests/workspaceSeats.test.ts`.

### Task 2.1: Store the subscription and history

**Staging storage note:** Schema 3 adds pending subscription records without
changing operational access. The domain layer requires explicit grace/seat
values and an active platform-admin actor. Admin/customer API and GUI workflows,
Riyadh date display, access enforcement and notices remain Tasks 2.2/2.3.

- [x] Add a subscription per workspace containing plan label, `starts_at`, `ends_at`, `grace_ends_at`, `seat_limit`, cancellation timestamp, suspension timestamp/reason, and `updated_at`.
- [x] Store a revision/version for concurrent admin updates. Record immutable activation, renewal, cancellation, seat-change, and suspension events with actor, old/new values, and a reason/reference to the external arrangement.
- [ ] Use UTC timestamps and an exclusive end boundary: access ends when `now >= ends_at`. Display customer dates in Asia/Riyadh.
- [x] For annual renewal, calculate one calendar year rather than 365 days. Clamp February 29 to February 28 in a non-leap year; preserve the time of day.
- [x] Early renewal extends from the existing end; late renewal starts from the recorded agreed restart date, defaulting to the confirmation date. Admin overrides must be explicit and audited.
- [ ] Derive status at request time: `pending`, `scheduled`, `active`, `grace`, `expired`, or `suspended`. Cancellation is a renewal instruction and does not immediately erase the remaining term. (Domain derivation tested; route integration remains Task 2.2.)

### Task 2.2: Add admin and customer workflows

- [ ] Add platform-admin screens/actions to create a pending workspace, activate a term, renew, adjust seats, mark cancellation, suspend, and reactivate.
- [ ] Validate dates, positive seat allowance, revision, and action reason. Duplicate activation requests must not extend the subscription twice.
- [ ] Add `GET /api/workspace/subscription` for the member-visible access summary and renewal contact information.
- [ ] Show plan label, included/used seats, term dates, status, and “Contact us to renew” in the customer UI. Do not display monetary amounts or payment actions.
- [ ] Provide an authenticated contact request or mail link containing only workspace name/ID and the requested action; never attach trip or credential data by default.
- [ ] Allow owners to administer staff inside their allowance. Owners/managers can manage permitted staff roles; only owners can assign managers or initiate ownership transfer. Platform admin handles owner replacement after identity verification.
- [ ] Count active memberships, including owners, toward seats. Pending invitations reserve seats until accepted or expired, so concurrent acceptances cannot exceed the allowance.
- [ ] A seat reduction below active usage requires the admin to identify which memberships will be disabled; never disable staff arbitrarily.

### Task 2.3: Enforce the access matrix everywhere

| State | Operational reads/export | Edits/import/ingest | Scheduled Telegram alerts | Contact/recovery/subscription view |
| --- | --- | --- | --- | --- |
| Pending/scheduled | No | No | No | Yes |
| Active | Role/grant dependent | Role/grant dependent | Yes when configured | Yes |
| Grace | Role/grant dependent | Role/grant dependent | Yes when configured | Yes |
| Expired | Role/grant dependent | No | No | Yes |
| Suspended | No | No | No | Yes, with verified support process |

- [ ] Apply the matrix on the server to every route category; use structured `403` responses such as `SUBSCRIPTION_READ_ONLY`, `WORKSPACE_SUSPENDED`, and `SEAT_LIMIT_REACHED`.
- [ ] Keep the UI in read-only mode when expired while retaining authorized export; reject stale-tab writes regardless of UI state.
- [ ] Recheck access for WebSocket connections and events, workers, Telegram testing, manual alert triggers, and extension capture. Do not rely on a nightly status update.
- [ ] Restrict global alert debug/trigger tools to platform admins; a customer action may inspect or trigger only its authorized workspace jobs.
- [ ] Add a notification outbox and reminder job with uniqueness per workspace, term revision, reminder type, and channel. Retry failures with bounded backoff and surface failures to admins.
- [ ] Maintain verified workspace contact email and a notification delivery adapter. Use transactional email for renewal/recovery notices; keep in-app notices as a second channel. Staff may contact customers manually where delivery fails.
- [ ] Queue customer communications for approved workflows; the planning work itself sends no messages.

**Acceptance scenarios:** An active term permits normal work; the exact expiry boundary enters grace; the exact grace boundary rejects all writes but permits authorized export. Direct API calls and extension ingestion cannot bypass expiry. Early and leap-year renewals calculate correctly. Concurrent seat changes/invitations cannot oversubscribe. Duplicate reminders/actions do not create duplicate effects.

## 8. Phase 3 — Secure accounts, recovery, and administrator access

**Files:** `server/sessions.ts`, `server/recovery.ts`, `server/mfa.ts`, `server.ts`, `services/api.ts`, `components/Auth.tsx`, `components/Profile.tsx`, extension authentication code, and `tests/sessionSecurity.test.ts` / `tests/accountRecovery.test.ts`.

- [ ] Store revocable sessions and hashed refresh-token identifiers, device labels, expiry, rotation history, and revocation time. Use short access-token lifetimes and rotate refresh tokens; reused rotated tokens revoke their session family.
- [ ] Revoke all sessions after administrator password reset, customer password change, recovery completion, or account disablement. Check session/account/membership state on API calls and close affected live connections.
- [ ] Add session listing and “Log out all devices.” Browser logout revokes the current session server-side before clearing local state.
- [ ] Use Secure, HttpOnly, SameSite cookies for browser sessions with CSRF protection on mutations. Explicitly configure reverse-proxy trust and credentialed CORS.
- [ ] Keep a separate scoped/revocable extension session protocol using extension storage. Never require the extension to read an HttpOnly browser cookie or fall back to unrestricted long-lived browser tokens.
- [ ] Add verified email to accounts through a single-use, expiring verification link. Support-led accounts can be provisioned without public signup.
- [ ] Add password recovery using generic account-existence responses, rate limiting, hashed one-use tokens, a short expiry, and a password reset page. Do not email passwords.
- [ ] Document support-assisted recovery for a customer who loses email access; require identity verification and audit the action.
- [ ] Require MFA for platform admins, using TOTP with encrypted enrollment secrets and hashed single-use recovery codes. Until enrollment is complete, permit only enrollment/recovery actions.
- [ ] Require recent password/MFA verification for high-impact admin actions and verified recovery for MFA resets.
- [ ] Redact tokens, passwords, reset links, and MFA secrets from logs; avoid sensitive tokens in WebSocket URLs by using a short-lived single-use connection ticket.

**Acceptance scenarios:** Password reset invalidates old browser, refresh, extension, and WebSocket access. Recovery tokens expire and cannot be replayed. An attacker cannot enumerate accounts through recovery responses. Admin access requires MFA. Cookie-authenticated writes fail without valid CSRF protection. An admin cannot grant customer users platform-admin authority through ordinary membership editing.

## 9. Phase 4 — Enforce security configuration and data lifecycle

**Files:** `server.ts`, focused server modules, `.env.example`, `README.md`, `tests/securityConfiguration.test.ts`, `tests/customerDataLifecycle.test.ts`, and `docs/operations/security.md`.

- [ ] Fail production startup if JWT/session secrets or the 32-byte settings-encryption key are missing, malformed, or known example values.
- [ ] Migrate plaintext integration secrets to authenticated encryption after a verified backup; prove existing settings still decrypt. Define key IDs/rotation and recoverability without exposing keys in the repository.
- [ ] Verify HTTPS termination, secure cookies, proxy handling, production CORS allowlists, CSP/security headers, request size limits, and authentication/recovery rate limits.
- [ ] Inventory dependencies and extension permissions, resolve applicable serious vulnerabilities, add dependency alerts and secret scanning, and keep deployment credentials least privileged.
- [ ] Preserve audit records for security, membership, subscription, sharing, export, and deletion actions while minimizing personal data. Set an approved retention schedule and restrict audit visibility.
- [ ] Add an owner-authorized workspace export and a support-managed deletion request with identity verification, recorded scope, confirmation, and a completion receipt.
- [ ] Treat account offboarding, trip deletion, and workspace deletion as different actions. A removed employee must not delete the workspace's trips.
- [ ] For workspace deletion, remove/revoke source invitations, grants, sessions, integration credentials, operational records, and linked queued jobs in a defined order. Keep only justified minimal audit evidence.
- [ ] Schedule retention notices and reviewed deletion eligibility from approved policy dates; expiry alone must never immediately erase data.
- [ ] Document that backups expire on their retention schedule. Maintain deletion tombstones outside the restored snapshot and replay them before reopening a restored service, so previously erased data does not reappear.
- [ ] Finalize hosting location and subprocessors, including Telegram and the email service; document what customer information each receives and how any international transfers are handled.
- [ ] Create an incident response guide covering containment, evidence, customer communication ownership, recovery, and review of applicable notification duties.

**Acceptance:** Production cannot silently store new sensitive integration settings as plaintext. Export excludes other companies and credentials. Deletion is scoped and auditable, and a restore does not reintroduce data marked for erasure. Public security claims can be tied to verified configuration.

## 10. Phase 5 — Make backup and restoration reliable

**Files:** `scripts/db-backup.mjs`, proposed `scripts/verify-backup.mjs`, deployment/host configuration, `tests/dbBackup.test.ts`, and `docs/operations/backup-and-restore.md`.

- [ ] Keep online SQLite backups using the SQLite backup API; verify integrity and schema metadata before declaring success.
- [ ] Produce hourly backups and upload encrypted copies off the VPS. Retain the agreed schedules and verify upload timestamps/checksums.
- [ ] To meet the proposed one-hour data-loss objective after total VPS loss, upload each hourly backup off-server as well; retain hourly off-server copies for 7 days plus daily copies for 30 days.
- [ ] Store backup encryption/settings keys separately in a protected secrets location accessible through the documented recovery process.
- [ ] Monitor backup freshness, verification, upload failures, disk space, and storage retention. A local cron log alone is not proof of recovery readiness.
- [ ] Install/schedule backup jobs through a dedicated operations step with the minimum required permissions; fail setup visibly if scheduling did not succeed.
- [ ] Refuse restoration while the application/alert worker is running. Verify the selected snapshot, take a consistent safety snapshot, and handle stale WAL/SHM files before opening the restored database.
- [ ] Recover onto a clean isolated host, disable outbound customer jobs, restore schema/data/keys, replay deletion tombstones, invalidate restored sessions/recovery tokens, and validate isolation and subscriptions.
- [ ] Reconcile reminders/alerts before resuming outbound jobs so restoration does not resend stale notifications.
- [ ] Record actual data-loss interval and restoration duration. Investigate any failure to meet the approved recovery objectives.

**Acceptance:** An operator follows the guide on a clean host and recovers usable, isolated customer data and encrypted settings without the original VPS. Backup failure reaches the responsible operator. There is dated evidence of a successful full restore drill.

## 11. Phase 6 — Release safely and detect failures

**Files:** `.github/workflows/deploy.yml`, proposed `.github/workflows/checks.yml`, PM2/proxy configuration, health endpoint module, `tests/deployWorkflow.test.ts`, and `docs/operations/deployment.md` / `monitoring.md`.

- [ ] Run `npm ci`, `npm run lint`, `npm test`, `npm run build`, and extension tests/package checks before a production release. In the extension directory use `node --test test/*.test.js` if the existing Node test setup still applies.
- [ ] Use immutable release directories/artifacts. Install and build a candidate while the current release remains running; prevent simultaneous production deployments.
- [ ] Package and version the extension with the release. Keep a manifest of app version, schema version, and extension version.
- [ ] Rehearse migrations on staging; take and verify a production snapshot before mutation. Use additive compatible migrations where possible.
- [ ] Perform the short final migration/restart/switch step only after release preparation succeeds. Document a maintenance window where SQLite schema changes cannot safely be performed online.
- [ ] Add internal liveness/readiness probes exposing no system details; preserve detailed health information behind platform-admin authorization.
- [ ] Verify login, workspace read/write, static assets, database readiness, and live updates after deployment using dedicated non-customer probe data.
- [ ] Keep the previous release and define rollback separately for compatible code changes and incompatible schema changes. A database restore may discard writes and requires explicit operational coordination.
- [ ] Add external uptime checks and alerts for sustained API failures, backup age, disk capacity, worker heartbeat, alert-delivery failures, and email delivery backlog.
- [ ] Include safe request IDs, workspace IDs, release version, and error categories in diagnostics; redact secrets and avoid logging raw pilgrim data.
- [ ] Prevent overlapping alert runs and duplicated workers. Keep a single scheduler initially, with durable job state and retry limits.
- [ ] Exercise alert failures and recovery notifications in staging; ensure monitoring remains useful when the app/database itself is unavailable.
- [ ] Run a realistic capacity check using synthetic agency workloads; measure concurrent edits, sync size, database latency, and memory. Add pagination/request limits as measurements require.

**Acceptance:** A failed build leaves the current release available. A bad release can be rolled back using a rehearsed procedure. Production does not deploy when required checks fail. Simulated downtime/backup/job failures notify the operator outside the app. Concurrent notifications and editing remain correct under the agreed pilot workload.

## 12. Phase 7 — Finish customer onboarding, extension reliability, and policies

**Files:** customer/admin components, public pages, extension sources/packaging, `docs/customer/getting-started.md`, `docs/customer/extension-guide.md`, `docs/operations/customer-support.md`, and `docs/operations/subscription-administration.md`.

### Task 7.1: Contact-led customer journey

- [ ] Explain annual company access, included seats/features, renewal by contacting the team, and support channels without showing prices or payment controls.
- [ ] Provide an admin checklist: contact request → verify company/contact → create pending workspace → confirm external arrangement → activate term → invite owner → verify onboarding.
- [ ] Make customer invitation links single-use and time-limited, with customer-chosen passwords; never send reusable passwords through support messages.
- [ ] Add a first-use checklist for account security, first trip import, member setup, sharing, Telegram configuration, and export.
- [ ] Show actionable reasons for disabled actions, such as viewer access or expired subscription, with the appropriate contact route.
- [ ] Check mobile layouts, Arabic RTL, existing English content, keyboard use, form labels, loading/error states, and reconnect/save conflict behavior.

### Task 7.2: Extension and import fallback

- [ ] Publish installation, authorization, capture, update, reauthentication, and troubleshooting instructions for the supported distribution method.
- [ ] Review the current `<all_urls>` host permission. Restrict automatic capture to intended Nusuk/Hajj origins; use active-tab or optional permissions for deliberate capture from other pages.
- [ ] Bind sessions and requests to the configured UM Track origin and authorized workspace. Never attach credentials to unrelated hosts.
- [ ] Show unsupported-version, session-revoked, read-only-subscription, network failure, and parse failure states in the extension.
- [ ] Add an update/version check appropriate to self-hosted distribution; an update notice must not promise automatic updates that sideloaded installations do not provide.
- [ ] Preserve pasted-text/import preview and manual entry when Nusuk markup changes. Preview errors must not overwrite or silently duplicate saved trips.
- [ ] Keep sanitized parser/capture fixtures and an operator checklist for compatibility checks after source-site changes.
- [ ] Review applicable source-platform terms and required permissions before presenting the integration as supported; describe its dependencies accurately.

### Task 7.3: Policies and support readiness

- [ ] Update annual terms with start/end boundaries, manual renewal, cancellation effective date, grace/read-only behavior, seats, support scope, data access, and approved retention/deletion rules.
- [ ] Describe how external cancellation/refund requests are handled by contacting the team; do not implement financial calculations, transactions, or payment records.
- [ ] Update privacy/security/cookie pages to describe actual hosting, subprocessors, browser session storage, data lifecycle, and incident contact.
- [ ] Document customer/platform responsibilities for pilgrim information and obtain review of applicable Saudi PDPL/data-processing obligations. Do not claim compliance certification from the plan alone.
- [ ] Publish support hours and realistic response targets, with an urgent incident route that is actually staffed.
- [ ] Prepare playbooks for recovery, failed imports, missing alerts, sharing mistakes, seat changes, cancellation, renewal, export, and deletion.
- [ ] Record customer acceptance of the applicable terms version/date during onboarding or through the approved contact process.
- [ ] Ensure every public statement about HTTPS, encryption, backups, hosting, and support matches launch evidence.

**Acceptance:** A new agency can contact the team, receive a provisioned workspace, activate access, onboard staff, import a trip, and export its data. It can find renewal/recovery/support instructions without any payment UI. Extension failures have a tested manual fallback, and public policies match the system.

## 13. Phase 8 — Pilot with agencies and decide whether to launch

**Files:** `docs/operations/pilot-checklist.md` and `docs/operations/launch-evidence.md`.

- [ ] Select 3–5 agencies, assign a support contact, and record the intended workflows and allowed pilot data.
- [ ] Rehearse workspace creation, invitation, seat enforcement, activation, early/late renewal, cancellation, grace, read-only expiry, and reactivation using controlled dates.
- [ ] Exercise the daily workflow: extension/paste import, preview, duplicate detection, editing, driver/status changes, filtering, analytics, live updates, shared trips, recycle bin, and export.
- [ ] Verify alert timing in Asia/Riyadh, Telegram delivery failures, worker restart behavior, and notification deduplication.
- [ ] Verify two unrelated workspaces with identical group/agency values and explicit cross-company sharing, including revocation and expired source/recipient access.
- [ ] Verify password recovery, lost-device logout, MFA recovery, employee offboarding, ownership transfer, export, and deletion.
- [ ] Complete a backup restore drill and a failed-release/rollback rehearsal, documenting results.
- [ ] Collect onboarding time, import success/failure, lost/duplicated edits, alert reliability, support demand, and capacity measurements.
- [ ] Resolve all critical/high security, data-loss, isolation, access, and recovery issues before accepting general annual commitments.
- [ ] Assign an owner and documented customer workaround to any remaining lower-severity issue; review whether the workaround is suitable for launch.
- [ ] Record the product owner's launch decision and the dated evidence for each gate below.

## 14. Validation plan for implementation

No tests are added or run as part of writing this document. The following checks belong to the future implementation phases.

| Test area | Required proof |
| --- | --- |
| Isolation | Same group/agency across companies cannot broaden access; foreign trip IDs and live events stay isolated |
| Migration | Existing record counts, ownership, settings, and intentional shares survive; ambiguous grants fail closed |
| Subscription | UTC boundary, leap year, manual renewals, grace, cancellation, suspension, and stale-client writes behave as defined |
| Collaboration | An expired source or recipient cannot bypass restrictions through another active company |
| Seats | Concurrent invitations/activation cannot exceed the allowance; owner transfer preserves company data |
| Sessions | Reset/logout/disable/MFA recovery revoke affected browser, extension, refresh, and WebSocket access |
| Recovery | Single-use reset/invitation tokens, expiry, rate limits, and non-enumerating responses |
| Data lifecycle | Export excludes secrets/foreign data; deletion and restored tombstones preserve erasure decisions |
| Backup | Verified off-server recovery includes encryption keys, schema, subscription state, and session invalidation |
| Release | Failed preparation leaves service running; checks block bad releases; rollback works |
| Operations | Outage, stale backup, worker failure, and failed delivery generate external notifications |
| Customer flow | Contact → provision → activate → invite → import → collaborate → export → renew/cancel |
| Extension | Scoped credentials/permissions, denied writes after expiry, capture failure, version warning, and manual fallback |

Use the existing `npm run lint`, `npm test`, and `npm run build` commands, plus the extension's Node tests. Add targeted regression tests in the owning phase and run the full checks at integration/release milestones. Use staging and synthetic data for destructive or failure simulations.

## 15. Launch gates

- [ ] No known cross-workspace data leak or sharing collision.
- [ ] Existing customer data migration has been rehearsed and reconciled.
- [ ] Contact-managed activation/renewal, dates, seats, and access restrictions work on every relevant entry point.
- [ ] Customers have secure recovery; issued sessions can be revoked; platform admins use MFA.
- [ ] Production secrets/encryption/HTTPS are enforced and recoverable.
- [ ] Off-server backups are verified, monitored, and restored successfully within approved targets.
- [ ] Deployment checks, health verification, external monitoring, and rollback are operational.
- [ ] Data export, retention, offboarding, and deletion procedures are documented and demonstrated.
- [ ] Public policies, hosting/subprocessor disclosures, support channels, and annual subscription terms match reality.
- [ ] Extension installation/update instructions and manual import fallback are ready.
- [ ] Pilot agencies have completed the important workflows and blockers are closed.
- [ ] A named person owns production incidents, subscription administration, backup recovery, and customer support.

## 16. Coverage of the launch assessment

| Original recommendation | Planned work |
| --- | --- |
| Company isolation and company-owned trips | Phase 1 |
| Fix globally matching group/agency grants | Phase 1 |
| Annual subscription, expiry, renewal, and seats | Phase 2 |
| Account recovery, session invalidation, admin MFA | Phase 3 |
| Correct encryption/public security guarantees | Phases 4 and 7 |
| Off-server backups and demonstrated restoration | Phase 5 |
| Safer deploy, checks, health, rollback, external alerts | Phase 6 |
| Annual cancellation/expiry/support policies | Phases 0, 2, and 7 |
| Privacy, hosting, subprocessors, customer data responsibilities | Phases 4 and 7 |
| Company continuity when employees leave | Phases 1, 3, and 4 |
| Contact-based onboarding and administration | Phases 2 and 7 |
| Nusuk extension installation/updates/fallback | Phase 7 |
| 3–5 agency pilot and complete workflow validation | Phase 8 |
| Tax/prices and automated payments | Excluded by user instruction |

**Completion means:** UM Track can safely provision agencies, administer annual access through direct contact, preserve company data and collaboration boundaries, recover from failures, and support customers under documented policies.
