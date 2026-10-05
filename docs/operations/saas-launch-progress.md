# Execution ledger — plan: docs/superpowers/plans/2026-09-30-saas-launch-readiness.md

## October 3, 2026 — Phase 0 in progress

The user authorized implementation task by task. The plan is the requirements
source; no separate SaaS spec is linked. Preserve pre-existing extension,
parser, package and test edits. Work is on existing `staging`, not main/master.
`RTK.md` referenced by supplied instructions was not found in this repository,
its parent tree, or the checked skill/config roots; no RTK behavior assumed.

Pre-flight dependencies:

| Producer → consumer | Contract / finding |
| --- | --- |
| Phase 0 → Phase 1 | Reviewed account/workspace/owner mapping is required; local accounts have no company assignments. |
| Phase 1 → Phases 2/3 | Workspace ownership and active membership must underlie subscriptions, sharing, seats and sessions. |
| Phases 1–3 → Phase 4 | Session revocation/offboarding and ownership must precede scoped erasure/export. |
| Phases 4/5 → Phase 6 | Compatible schema, verified backups, key recovery and tombstone replay precede release/rollback. |
| Phases 0–6 → Phases 7/8 | Public policies/pilot gates depend on approved values and verified operations. |

Ruling: work in the existing staging checkout for this bounded Phase 0 change
using new files and precise plan checkbox edits — preserves the user's
uncommitted application baseline, which a HEAD-only worktree would omit — cost
if wrong: these new artifacts need moving to an isolated branch before merge.

Ruling: Phase 0 approval tasks remain open while independent inventory and
read-only migration tooling proceed — the plan explicitly calls defaults
proposed and requires reviewed ownership — cost if wrong: production migration
must wait for correct company/owner decisions, never guessed labels.

Ruling: use this durable phase ledger instead of the skill's integer task
completion helper — the source plan begins with unnumbered Phase 0 deliverables
and uses tasks 1.1/1.2/1.3 rather than the helper's integer brief format — cost
if wrong: resume from checked acceptance items and this ledger manually.

Delivered artifacts:

- Route and background-action inventory with target access categories.
- Policy/ownership transfer/support draft with explicit pending approval.
- Identifier-only local migration review sheet.
- Standalone read-only readiness CLI; no server bootstrap/mutations/messages.
- Synthetic SQLite regression tests for collisions, orphan records, creator
  versus grantor, sensitive-output exclusion, disabled accounts, legacy trash,
  integrations, no mutation/missing-file creation and CLI validation.

Evidence: original baseline 357/357 tests pass with socket permissions.
Initial sandbox baseline interrupted server/consistency workers; rerun outside
that restriction passed. New readiness suite 13/13 passes. Local inspection
reconciles 4,658 trips to accounts 1/2/7; no company IDs are assigned. Local
counts are not production rehearsal evidence. A repeat local inspection at
`2026-10-03T13:30:13.285Z` produced the same counts. Type check and production
build passed; Vite reports its existing >500 kB chunk warning. Extension Node
tests passed 45/45 without changing the user's extension work.

Independent review found two Important issues, both reproduced and fixed:

- Final: fixed SQLite scope coercion losing JS boolean/array/object semantics —
  two synthetic collision tests RED → reconstruct field type before JS String
  normalization → GREEN; workspace/consistency suites 36/36.
- Final: fixed corrupt INTEGER-affinity foreign IDs being serialized verbatim —
  corrupt-ID redaction test RED → safe integer validation/null plus review flags
  → GREEN; workspace/consistency suites 36/36.

No Critical or Minor findings were reported. Review set aside owner/company
assignments, policy approval, production counts, migration rehearsal and runtime
enforcement. Ruling: those remain explicit incomplete phase gates — code review
cannot establish customer authority or production evidence — cost if wrong:
launch/migration is delayed until verified rather than claiming unearned safety.

An intermediate full-suite run had a socket hangup in the existing consistency
test `does not blank the stored deletedRows mirror when purging a single row`.
No application/server code changed in this batch; the entire consistency suite
passed on its next run. No cause established and no speculative server change
made. Final full-suite rerun passed 370/370 across 22 files. Final type check,
production build, script syntax check and `git diff --check` passed. The build
retains the existing large-chunk warning. No deferred Minor review findings.

Session setup also required `npx claude-mem@latest install`. Initial sandbox
registry lookup failed; the escalated installer completed v13.28.0 locally.
It kept the configured provider/account and cloud sync off; worker autostart
was skipped. This is environment setup, not a SaaS plan completion item.

Open Phase 0 gates: policy approval; company groupings and owners; production
snapshot mapping/share review; integration/legacy-trash/orphan-setting choices;
approved support channels and ownership-verification process. No Phase 1
schema migration has been applied. Resume here after decisions are recorded.

## October 3, 2026 — Staging Phase 1 implementation

User instruction: "start, and only appy to staging." This authorizes development
and application on staging. Production mapping/approved launch policy gates
remain open for production; they do not block staging feature implementation.

Ruling: enable workspace behavior only with the staging deployment environment
or explicit test mode — current production behavior remains on its legacy path
and main is not changed — cost if wrong: staging deployment environment must be
set correctly before features appear.

Ruling: stage unassigned accounts into individual workspaces, retain existing
company-ID associations and give the first active member owner authority — no
profile/group/agency name inference, production review still required — cost if
wrong: staging membership roles/grouping need correcting before production use.

Ruling: retain ambiguous legacy sharing and orphan settings in private migration
quarantine and verified pre-migration snapshots — no guessed source-company
grants — cost if wrong: deliberate legacy sharing needs explicit reauthorization
in staging; rollback uses the snapshot with matching code.

Implemented: numbered transactional workspace schema, memberships, indexed
company-owned trips, source-scoped sharing, active-membership authorization,
separate integration/personal settings, staging-only feature gate, membership
management UI and viewer table mode. New trips always belong to the creator's
workspace, including when group/agency labels match external shared trips.
Disabled employees retain membership/trip history. Source authority is rechecked
on invitation acceptance. Migration includes foreign-key validation and a
verified online pre-migration backup on staging startup. Production does not
execute this migration.

Scheduled staging outbound alerts default to disabled unless the operator
explicitly configures STAGING_OUTBOUND_ALERTS=true; unit tests use mocks. No
customer messages are sent by this implementation/rehearsal workflow.

Validation in progress: staging API suite, legacy compatibility suite, copied
database migration rehearsal, live-update/alert checks and independent review.

### October 5 — verified staging release candidate

Independent read-only review reported five Important issues and no Critical
issues. All five were reproduced with failing tests and corrected:

- Settings no longer returns the legacy cached trash mirror; revoked trip
  contents cannot bypass the authorized database trash endpoint.
- Import overwrite affects only the caller's owning workspace, never editable
  external groups with the same label.
- Workspace owners/managers can permanently purge former employees' trips;
  creator IDs remain historical, not the authorization boundary.
- Scope-changing PATCH/sync invalidates both former and current recipients.
  A successful edit that ends its caller's access returns no row content, and
  the UI removes that row without treating the committed edit as an error.
- Integration conflict flags persist through ordinary autosaves and require an
  explicit owner/manager resolution. The settings UI exposes the review state.

Additional regression: creating a trip without group/agency labels still
notifies workspace colleagues. Live tests also prove foreign-workspace event
isolation and immediate socket closure on account disablement. Worker tests
prove source-only nondeleted trips and once-per-workspace alert deduplication.

Local-copy rehearsal preserved all 4,658 trips' IDs, creators, JSON and deletion
timestamps, with integrity ok and zero foreign-key violations. Source data was
opened read-only and left unchanged. The protected copy received version 1;
three memberships and six quarantined orphan settings. See the rollout guide
for the matching staging snapshot/code rollback procedure.

Final working-tree evidence: 401/401 tests in 25 files, 45/45 extension tests,
TypeScript check, build and whitespace check pass. The build retains its
existing >500 kB chunk warning. A preliminary regression run had a transient
403 during synthetic admin provisioning; the isolated import test reproduced
the real overwrite defect, and subsequent full suites passed. No cause for the
transient provisioning response was established.

The release excludes the user's pre-existing parser/extension/package/test
edits. Exact committed-source verification and live staging deployment are the
next checks; no production migration, messages or launch claim is authorized.
Subscription-aware sharing and production mapping/conflict approvals remain
unchecked in the source plan. Next engineering phase is annual subscriptions.

Committed-source verification of `347185050ec55877cbd0fce92fd06fba7d27250d`
used a new temporary git-archive snapshot without the dirty parser/extension
changes or local .env: 391/391 application tests, 41/41 extension tests,
TypeScript check, build and extension packaging passed. Different working-tree
counts above include the user's additional uncommitted tests. The published
extension version remains 2.0.1. No unrelated changes are in this release.
