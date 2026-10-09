# Company-wide trip sharing (staging)

Approved October 9, 2026: a platform-admin toggle per company; the company
manager can always see all company trips. Owners retain the same oversight.

Open **Admin → الشركات → مشاركة جميع الرحلات**.

- **ON:** every active company member sees company trips. Existing roles still
  control edits, restoration, sharing and purge; viewers remain read-only.
- **OFF:** editors/viewers see their creator-owned trips plus accepted explicit
  shares. Owners/managers still see all company trips, including offboarded
  employee history and trash. Other companies never gain implicit access.
- Existing and new companies default ON. Turning OFF does not delete, move,
  recreate or change trip ownership/history. Turning ON restores implicit
  company visibility. Only platform admins can change the toggle.

Accepted row/group/agency shares are intentionally retained. OFF is not a revoke
all-manual-shares switch. To remove a particular share, revoke that grant too.
When OFF, ordinary staff can create/manage row shares for their own trips;
company-level group/agency scope sharing requires owner/manager authority,
because those scopes can contain coworkers' current or future private trips.
Pending invitations recheck the sender's current sharing authority on acceptance.

Backend reads, writes, trash, duplicate lookup, extension ingestion, sharing
metadata, alert diagnostics and live-event recipients check current policy.
Invisible restore/sync retain their existing non-enumerating safe no-op response;
they cannot modify hidden trips. Settings hide unauthorized notified trip IDs.
Workspace Telegram remains the manager-administered company integration, not a
per-account private channel. This setting cannot retract previously exported
files, cached data outside the app or delivered Telegram messages.

Connected browser tabs receive an invalidation; reconnecting tabs reconcile
against the API. Request generations prevent older responses or errors from
replacing newer authorized data. Filtered/export selections and open share
targets are reconciled too. Live-effect dependencies use account identity/role,
not settings objects, so loading permissions does not create a reconnect loop.

## Migration and verification

Staging schema 4 adds `companies.share_all_trips` with a boolean constraint,
default ON and a creator/workspace/trash index. Startup takes a verified online
snapshot before upgrading; numbered changes are transactional and restart-safe.
The post-deployment verifier requires version 4 and the policy column. Production
does not run this migration or expose the new mutation endpoint.

UI uses the existing Arabic RTL company table and gold/gray styles. The 21st CLI
and design context were unavailable; no new UI library, generation service or
dependency was installed. The native switch has a company-specific label,
saved-state semantics, keyboard focus, saving/disabled feedback and inline errors.

Independent review found no Critical backend defect. Two Important client gaps
(missed reconnect invalidations and out-of-order responses) were verified against
App's code, then fixed with four deterministic RED→GREEN regressions. No second
review. Customer DBs/secrets/external services and unrelated dirty files were
excluded; live release claims require separate aggregate verification.

Evidence so far: 477/477 working-tree application tests, type check, build and
whitespace check pass. Existing >500 kB bundle warning remains. Read-only local
copy rehearsal preserved 4,658 trips and passed integrity/FK checks with schema
versions 1/2/3/4. Exact-source and live deployment evidence follow after release.

The first clean parallel release run had transient failures in synthetic sharing
fixture sync (403), existing patch-invalidation share creation (403), and the
existing oversized-body security test (EPIPE). Another parallel run failed an
existing share acceptance (401). The unchanged exact source passed all 467
tests with one worker; the working tree passed all 477 tests again after adding
safe login/response/membership diagnostics. No root cause was established and
no authentication or production behavior was weakened to make these pass.
The clean snapshot's type check/build, 41 extension tests and package check pass.

Manual browser verification was blocked by missing computer-use permissions.
The localhost-only, synthetic in-memory probe was stopped; no customer database
was used. API/live integration and rendered accessibility checks passed. Do not
represent these checks as a completed manual browser smoke test.
