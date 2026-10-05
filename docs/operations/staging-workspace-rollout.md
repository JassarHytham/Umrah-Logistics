# Staging workspace rollout

This batch applies only to the `staging` branch and staging deployment. Do not
merge into `main`, set the staging flag on production, or restore a staging
database into production.

**Approved recovery:** The user authorized assigning all five orphan trips to
a new testing company and proceeding. The staging rollout now enables workspace
mode and supplies `STAGING_ORPHAN_TRIP_COMPANY=Staging Testing Company` and
`STAGING_ORPHAN_TRIP_COUNT=5`. Assignment is atomic and refuses a different
orphan count, invalid creator IDs or an already existing company with that name.
Live migration/health verification is required before claiming activation.

Missing creator IDs are retained as locked, disabled historical records, not
revived login accounts. Their unknown original names are not invented. These
records receive no membership or owner authority, cannot log in/refresh, and
cannot be activated, password-reset or deleted through admin APIs. Old settings
for these identities remain in private quarantine. Trip IDs, creator IDs, JSON,
versions and deletion history are compared before/after migration and preserved.

The first real account created by an admin for this testing company becomes
its owner. In the admin GUI, create a user and select **Staging Testing Company**;
sign in as that user to view its active trips and recycle bin. No shared/default
testing password is generated. Existing owners can open **Settings → المشاركة
والصلاحيات → أعضاء الشركة** to manage their staff. Outbound staging alerts remain
off by default. Never disable workspace mode on a migrated database without a
matching snapshot/code rollback.

## Trial decisions

- Existing company IDs remain authoritative; unassigned accounts receive
  separate workspaces. The first active account is owner. Account profile names
  and group/agency labels do not establish ownership.
- Legacy shares are quarantined, not silently converted. Owners/editors must
  explicitly share source-workspace scopes again. Quarantine is private and may
  contain sensitive legacy settings; do not export it through customer APIs.
- Conflicting integration settings are retained for review. Owners/managers
  must explicitly approve replacement company settings; autosaving does not
  clear the review flag.
- Owners/managers can manage staff and permanently purge their workspace's
  trash. Editors can edit/soft-delete/restore authorized trips and share explicit
  source scopes. Viewers cannot write. Ownership transfer is not implemented.
- Subscription enforcement, seat limits, secure sessions/MFA and production
  ownership approval remain later plan items, not completed launch features.

## Deployment and verification

The existing GitHub Actions staging deployment uses `/var/www/umrah-staging`,
PM2 `umrah-staging` and `/var/lib/umrah/staging/umrah.db`. It sets
`UMRAH_DEPLOYMENT_ENV=staging`; `NODE_ENV=production` still controls static serving.
Only staging can run the workspace migration and its post-deployment verifier,
after its enable flag is changed following approved ownership review.
While blocked, deployment reports aggregate orphan counts and verifies an
unauthenticated HTTP request is rejected with 401 by the running staging API.
Staging no longer rewrites the shared production backup cron configuration.

Startup makes an online snapshot in the database directory's
`workspace-migration-backups/before-workspaces-<timestamp>.db`, verifies its
integrity, and runs the initial workspace migration atomically. Version 2 records
the protected historical-creator marker; existing version-1 staging databases
are upgraded idempotently. Failure aborts startup.
The deployment verifier waits up to 30 seconds, then checks schema version 2
and its archived-creator marker,
integrity, foreign-key consistency and non-null trip workspace ownership.
It reports aggregate counts only. A failed job requires investigation; PM2
restart alone is not verification. Full prepare-release/health rollback
automation remains Phase 6.

Scheduled outbound staging alerts are disabled unless the operator explicitly
sets `STAGING_OUTBOUND_ALERTS=true`. This rollout sends no renewal notices.
Synthetic worker tests mock Telegram delivery.

## Rehearsal evidence

`scripts/rehearse-workspaces.ts --db umrah.db` opens the source read-only and
backs up to a new protected temporary directory before migrating that copy.
October 3 rehearsal: all 4,658 trip IDs, creators, JSON and deletion timestamps
were byte-for-byte preserved; integrity `ok`; zero foreign-key violations;
schema version 1; three memberships; six orphan-setting entries quarantined.
This is local-copy evidence, not an approved production ownership mapping.

## Staging rollback (operator-run only)

1. Disable staging capture/alerts and stop **only** PM2 `umrah-staging`.
2. Preserve a separate online snapshot of the failed staging database and
   record the failed commit, selected pre-migration snapshot and snapshot time.
3. Validate the selected snapshot with SQLite `integrity_check`. Stage changes
   after its timestamp require reconciliation; restoration is not lossless.
4. Restore the pre-migration snapshot to **only**
   `/var/lib/umrah/staging/umrah.db` while the process is stopped. Archive and
   remove its old WAL/SHM sidecars before reopening; never pair restored main
   database bytes with newer sidecars. Keep the failed database recoverable.
5. Restore the matching pre-workspace application commit
   `63842f4bc944f6b0eb0a30e01d5dffaa1ea8709e` to the staging release, rebuild and
   restart only `umrah-staging`. Verify login, active/deleted trip counts,
   sharing and application health against the snapshot.

Do not roll back code alone: new-schema ownership triggers remain in the
database and older code cannot safely manage new memberships. This document
does not authorize executing restoration or changing production.
