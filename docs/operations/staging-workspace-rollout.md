# Staging workspace rollout

This batch applies only to the `staging` branch and staging deployment. Do not
merge into `main`, set the staging flag on production, or restore a staging
database into production.

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
Only staging runs the workspace migration and its post-deployment verifier.
Staging no longer rewrites the shared production backup cron configuration.

Startup makes an online snapshot in the database directory's
`workspace-migration-backups/before-workspaces-<timestamp>.db`, verifies its
integrity, and runs migration version 1 atomically. Failure aborts startup.
The deployment verifier waits up to 30 seconds, then checks schema version,
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
