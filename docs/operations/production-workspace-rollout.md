# Production workspace rollout

## Reviewed data and decision

The owner approved this production migration on October 10, 2026. The latest
online snapshot is
`/var/backups/umrah/prod/manual-pre-workspace-deploy-20261010T150108Z`,
with a verified local copy under
`/Users/jassar/Backups/Umrah-Logistics/manual-pre-workspace-deploy-20261010T150108Z`.
It contains 8,390 trips, 11 accounts, three existing companies, and 28 legacy
sharing records. The application archive and database snapshot are paired with
release `d4207f7`.

Existing company IDs 2, 3, and 4 stay in place. Account 2 (haytham) is the
owner of company 2; account 1 (jassar) becomes editor. Accounts 10 and 11 own
companies 3 and 4. Unassigned accounts 3 through 8 each receive a private
workspace. The platform admin receives no membership or empty workspace.

For company 2, `share_all_trips` starts disabled so its editor sees only
their own trips. The owner sees all company trips as required by the owner
role. New workspaces contain only their creator's trips.

The 15 legacy grants and 13 invitations are copied intact into
`workspace_migration_quarantine` and removed from active legacy access tables.
They do not automatically grant access across new workspace boundaries.
Review and recreate any intended shares through the new workspace controls.
The quarantine and the pre-migration backup preserve their original records.

Both accounts in company 2 have existing integration settings. The migration
retains each account's personal settings and marks workspace integration review
required; it does not select one Telegram destination for the company. The
owner must review and configure the company integration after activation.

## Guards and verification

`server/productionWorkspaceApproval.ts` pins the reviewed account, company,
and legacy share state, including a digest of the share records. A change to
those assignments or records aborts the
first production migration. This protects against applying an old decision to
different live ownership data. Trip count can grow as long as all creators
remain mapped and JSON is valid. The migration itself compares historic trip
records before and after, validates foreign keys, and runs transactionally.

Use `scripts/production-workspace-preflight.ts --db <snapshot>` on a fresh
online snapshot and `scripts/rehearse-production-workspaces.ts --db <snapshot>`
on an isolated copy before deployment. The rehearsal for the latest snapshot
preserved all 8,390 trip records and personal settings, assigned 10 memberships
across 9 companies, archived all 28 legacy sharing records, and passed SQLite
integrity and foreign-key checks.

The production deployment takes an online backup before stopping PM2, enables
`PRODUCTION_WORKSPACES_ENABLED=true`, then verifies workspace schema and
unauthenticated HTTP auth response after restart. The server makes another
online snapshot in the database directory before its first migration.

## Recovery

If activation fails, stop only `umrah-prod`, retain a separate snapshot of
the failed database, and restore the paired pre-migration database and code
`d4207f7` together. Do not run legacy code against the migrated database.
Archive WAL/SHM files with the failed database rather than pairing them with
the restored snapshot. Compare any writes after the snapshot before restoring.
Verify trip counts, login, admin routes, and SQLite integrity after restart.
