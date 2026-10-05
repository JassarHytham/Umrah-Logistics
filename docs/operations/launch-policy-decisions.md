# Launch policy decisions

Plan: `docs/superpowers/plans/2026-09-30-saas-launch-readiness.md`.
Status: proposed policies awaiting product-owner approval, October 3, 2026.
No notice schedules, retention deletion or public promises are authorized by
this draft. Keep approved values versioned in workspace policy configuration
when implemented and tie customer terms acceptance to that version.

## Proposed decisions for approval

| Decision | Proposed value | Approval |
| --- | --- | --- |
| Subscription unit | One annual term per company workspace | Pending |
| Customer membership | One workspace per account initially; platform admins separate | Pending |
| Calendar term | One calendar year from recorded UTC start; exclusive end; Feb 29 clamps to Feb 28; preserve time; display Asia/Riyadh | Pending |
| Renewal | Manual; early extends existing end; late uses agreed restart date, default confirmation date; audited overrides | Pending |
| Seats | Positive admin-set limit; active memberships including owner count; pending invitations reserve seats until accepted/expired | Pending |
| Seat reduction | Identify memberships to disable if new allowance is below usage; never select staff arbitrarily | Pending |
| Reminders | 30, 14 and 7 days before expiry, expiry and grace end; verified contact, deduplicated outbox | Pending |
| Grace | 7 days after term end; role-dependent reads/writes and configured alerts continue | Pending |
| After grace | Role-dependent reads/export; no operational writes/import/alerts; recovery and contact remain | Pending |
| Cancellation | Stops future renewal; access continues to term end and approved grace policy | Pending |
| Security suspension | Immediate block on operational reads/writes/alerts; verified support/recovery remain | Pending |
| Post-expiry retention | 90 days, prior notices and reviewed deletion; no automatic erase merely on expiry | Pending |
| Backup retention | Hourly local/off-server 7 days; daily off-server 30 days | Pending |
| Recovery targets | At most 1 hour data loss; restore within 4 hours | Pending |
| Support | Normal acknowledgement within 1 business day; staffed urgent route before launch | Pending |
| Sharing administration | Source owner/manager authority; explicit delegation rules for editors/resharing to be decided | Pending |
| Audit retention / invitation expiry / recovery-token expiry | Durations to be specified in owning phases | Pending |

Annual subscriptions remain contact managed. Prices, payments, checkout,
tax/invoicing calculations and monetary records are excluded by the plan.

## Proposed company ownership transfer process

1. An authenticated owner requests transfer to an identified active member of
   the same workspace. Only an owner can initiate; managers cannot promote
   themselves or create platform admins.
2. Require recent account verification. Platform support independently verifies
   company authority using a previously verified contact channel. Do not rely
   on a matching display name, trip details or newly supplied email.
3. Record requesting/receiving account IDs, workspace ID, verification method,
   reviewer and non-sensitive approval reference. Do not put identity documents,
   passwords, reset links, bot secrets or pilgrim data in logs.
4. Recipient confirms acceptance. Perform one transaction with the expected
   membership version, preserving workspace/trip IDs, creator history, grants,
   subscription term and seat accounting. Never leave the workspace without
   an owner; choose the outgoing owner's permitted role explicitly.
5. Revoke affected sessions/live authority and record the change. If the owner
   is unavailable, platform admin replacement requires independent company
   identity verification and an audited support decision.

This process is proposed for approval and later implementation; current admin
company reassignment must not be treated as an ownership transfer.

## Proposed support identity verification

Use the existing `/contact` page to receive requests. It currently links to
`jassar.official@gmail.com`; that is evidence of a published address, not
evidence that staffing, urgency coverage or company-authority verification
have been approved. Confirm the responsible person, business hours, time
zone, mailbox access and urgent incident channel before publishing targets.

For recovery/owner replacement/deletion, confirm workspace/account identifiers,
check the existing verified contact, verify company authority independently,
and record the evidence reference and reviewer. If email access is lost, use
a previously established independent company contact or a reviewed manual
verification route. Do not accept trip knowledge or an inbound email's display
name as identity proof. Do not send reusable passwords or customer trip data
through support messages. Issue expiring single-use links through the approved
recovery/invitation flow once Phase 3/7 implements it.

## Approval log

| Decision set | Approver | Approved values/exceptions | Date/reference |
| --- | --- | --- | --- |
| Subscription/access/seat defaults | Pending | Pending | Pending |
| Workspace owner/migration mapping | Pending | See workspace migration review | Pending |
| Ownership transfer/support verification | Pending | Pending | Pending |
| Support mailbox/hours/urgent route | Pending | Pending | Pending |

Record actual approval here when received. An unanswered question is not an
approval, and a local code/test result does not approve a business policy.
