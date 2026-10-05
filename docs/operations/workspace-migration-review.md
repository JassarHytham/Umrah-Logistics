# Workspace migration review

Phase 0 review sheet for `2026-09-30-saas-launch-readiness.md`.
Status: awaiting owner review; no ownership migration has run.

## Read-only inspection

Run from the project root:

```bash
node scripts/workspace-readiness.mjs --db /absolute/path/to/existing/umrah.db
```

The CLI requires an explicit existing database. It opens it read-only, enables
query-only mode and reads one transactionally consistent view. It never
imports `server.ts`, decrypts secrets, sends messages, changes ownership, or
approves mappings. Success means inspection succeeded, not migration approval;
`readyForMigration` remains false until a separately reviewed mapping exists.
It rejects a migrated/unsupported schema rather than guessing its semantics.

Output uses account/company IDs and aggregate counts. Company/profile names,
usernames, passwords, trip payloads, scope values and integration credentials
are excluded. Treat even this metadata as operator information; do not publish
it in customer pages. Grant review references use table name and SQLite rowid;
rerun the report before approval/application, because rowids may change after
database maintenance. Look up individual grants through an authorized private
operator view when deciding collaboration intent.

## Local database findings: October 3, 2026

Inspection at `2026-10-03T11:36:32.120Z` found 3 customer accounts, 0 company
records, 4,658 stored trips (4,656 live and 2 soft deleted), no orphan trips,
no invalid trip JSON, no sharing grants, no invitations, and no platform-admin
account in this local database. This is local evidence; repeat against a
protected consistent production snapshot before planning the live migration.

| Account ID | Active | Existing company ID | Live trips | Deleted trips | Reviewed workspace destination | Reviewed owner account ID |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Yes | None | 693 | 0 | Pending | Pending |
| 2 | Yes | None | 1,943 | 2 | Pending | Pending |
| 7 | Yes | None | 2,020 | 0 | Pending | Pending |

Do not assume these accounts are three different companies, or employees of
one company, from profile labels or trip values. The product owner must supply
their grouping and designate an owner for each workspace. Existing disabled
employees must retain disabled memberships for audit continuity. Trips belong
to the reviewed workspace; preserve their creator IDs as history.

### Settings and legacy trash

Accounts 1, 2 and 7 each have Telegram configuration present. Accounts 2 and 7
have alert settings present. No templates are configured for these accounts.
If accounts share a workspace, explicitly choose its integration settings;
the report conservatively requests review when multiple members have any
workspace configuration. It does not decide that encrypted ciphertext means
different secrets, and it never chooses the first member's configuration.

Account 2 also has 2 entries in legacy `settings.deleted_rows`. They may
overlap the 2 soft-deleted trip rows. Phase 1 rehearsal must reconcile IDs
privately; do not add the counts or drop the legacy entries without checking.

Settings rows for missing accounts 3, 4, 5, 6, 18 and 20 contain integrations.
Keep them quarantined for operator review; never attach them to a new account
or workspace simply because an ID or company label matches. No data was
removed during this inspection.

### Sharing review rules

There are no grants/invitations in the inspected local database. That does not
establish the production sharing state. For a production snapshot:

1. Review each row grant against the actual row's owner destination; the
   grantor may have been a recipient who reshared it.
2. Reauthorize every legacy group/agency grant with an explicit source
   workspace. Even one matching company is only a candidate, not proof of
   sender authority or collaboration intent. Repeated values across workspaces
   must never become a combined grant.
3. Confirm recipients have active memberships; retain existing viewer/editor
   roles only where approved. Missing/disabled/unmapped accounts fail closed.
4. Review pending and accepted invitations separately; acceptance must recheck
   current source authority, membership and subscriptions.
5. Record decisions by review reference, source workspace, recipient account,
   permitted role and approval reference. Do not record scope/pilgrim data or
   tokens here. Retain/reject/quarantine decisions must reconcile every grant.

## Approval record needed before Phase 1 application

- Product-owner decision on each account's workspace and membership role.
- Owner account ID for every workspace; distinct platform-admin authority.
- Integration/template/alert setting selection per workspace where necessary.
- Legacy-trash reconciliation and orphan-record handling.
- Per-grant/invitation source and collaboration approval on production snapshot.
- Reviewer, date, snapshot reference, counts and mapping version.

Approval must refer to a fresh snapshot/report. The Phase 1 migration tool must
validate complete account/trip coverage, approved workspace owners, orphan
handling and grants before a transactional mutation. Rehearse on an isolated
copy with outbound jobs disabled, compare record counts, test identical
group/agency values across companies, and verify a pre-migration snapshot plus
matching code/database rollback. This document is a review artifact, not an
executable migration or evidence that those rehearsals have passed.
