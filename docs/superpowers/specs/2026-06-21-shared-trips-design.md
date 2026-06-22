# Shared Trips — Design Spec
**Date:** 2026-06-21  
**Status:** Approved

## Problem

Trip data is currently private to one account. The app needs account-to-account collaboration where one user can share either a specific trip row or a group number with another existing account.

Access must be controlled through invitations. The receiver should not see the shared data until they accept. If they decline, nothing changes in their trips.

After acceptance, all collaborators edit the same canonical trip records. Edits, deletes, restores, and future group rows stay synced for everyone with access.

## Decisions

- Use one canonical trip row record, not per-user copies.
- Support two share scopes: row and group.
- Group sharing applies to current and future rows with the same `groupNo`.
- If any accepted group collaborator creates or imports a row with that shared `groupNo`, the row is shared back to all collaborators for that group.
- Delete is shared. Deleting a shared trip moves the same canonical row to the recycle bin for everyone with access.
- Restore is shared. Any collaborator who can see the deleted row can restore it for everyone.

## Data Model

Keep `logistics_rows` as the canonical trip table, but change the meaning from "rows owned and visible only by `user_id`" to "rows created by an owner and visible to the owner plus accepted collaborators."

### `logistics_rows`

- `id TEXT PRIMARY KEY`
- `owner_user_id INTEGER NOT NULL`
- `data TEXT NOT NULL`
- `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- `deleted_at DATETIME NULL`
- `deleted_by_user_id INTEGER NULL`

Existing `user_id` rows migrate to `owner_user_id` conceptually. The migration can preserve the physical column name initially if that keeps the change smaller, but all new authorization logic should treat it as the owner.

### `trip_share_invitations`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `sender_user_id INTEGER NOT NULL`
- `receiver_user_id INTEGER NOT NULL`
- `scope_type TEXT NOT NULL` (`row` or `group`)
- `row_id TEXT NULL`
- `group_no TEXT NULL`
- `status TEXT NOT NULL` (`pending`, `accepted`, `declined`)
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- `responded_at DATETIME NULL`

Constraints:

- A row invitation requires `row_id`.
- A group invitation requires `group_no`.
- Sender and receiver cannot be the same user.
- Duplicate pending or accepted invitations for the same receiver and scope should be rejected or treated as a no-op success.

### `trip_row_access`

- `row_id TEXT NOT NULL`
- `user_id INTEGER NOT NULL`
- `granted_by_user_id INTEGER NOT NULL`
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- primary key: `(row_id, user_id)`

Created when a row invitation is accepted.

### `trip_group_access`

- `group_no TEXT NOT NULL`
- `user_id INTEGER NOT NULL`
- `granted_by_user_id INTEGER NOT NULL`
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- primary key: `(group_no, user_id)`

Created when a group invitation is accepted.

Group access is membership, not a one-way grant. When a group invitation is accepted, both the sender and receiver must have `trip_group_access` rows for that `group_no`. This ensures future rows created by either accepted collaborator are visible to all collaborators for the group.

## Visibility And Permissions

A user can see an active row if any of these are true:

- they own the row;
- they have row access for that row;
- they have group access for the row's `groupNo`.

A user can see a deleted row in the recycle bin by the same rule.

A user can edit, delete, or restore a row if they can see it. This includes accepted collaborators.

A user can invite another user to a row if they can see that row.

A user can invite another user to a group if they can see at least one row in that group or already has group access for that group number.

## Backend API

### `GET /api/data`

Returns visible, non-deleted rows for the logged-in user.

Each row should include sharing metadata outside the normal trip fields:

```json
{
  "_sharing": {
    "shared": true,
    "ownerUsername": "account_a",
    "scope": "group"
  }
}
```

Private rows can omit `_sharing` or return `{ "shared": false }`.

### `GET /api/data/deleted`

Returns deleted rows visible to the logged-in user for the recycle bin.

Shared deleted rows include:

- owner username;
- deleted by username;
- deleted timestamp;
- sharing scope metadata.

### `POST /api/data/sync`

Keep the existing endpoint for compatibility, but make it conservative:

- create or update rows the user can edit;
- do not delete rows merely because they were omitted from the payload;
- do not wipe shared rows;
- prefer row-level endpoints for new frontend behavior.

This avoids the current full-table replacement behavior from deleting shared data accidentally.

### `PATCH /api/data/:id`

Updates one row if the user can see it. This is the preferred endpoint for inline table edits.

The server updates the canonical `data` payload and `updated_at`.

### `POST /api/data/:id/delete`

Marks the canonical row as deleted for everyone who can see it:

- set `deleted_at`;
- set `deleted_by_user_id`;
- do not remove access records.

### `POST /api/data/:id/restore`

Restores the canonical row for everyone:

- clear `deleted_at`;
- clear `deleted_by_user_id`.

### `POST /api/shares/invitations`

Creates a pending invitation by receiver username.

Request:

```json
{
  "receiverUsername": "account_b",
  "scopeType": "group",
  "rowId": null,
  "groupNo": "123"
}
```

Validation:

- receiver account must exist;
- sender cannot invite themselves;
- row share requires visible `rowId`;
- group share requires visible access to that group;
- duplicate pending or accepted access is rejected or returned as no-op success.

### `GET /api/shares/invitations`

Lists pending invitations for the logged-in user.

Each item includes:

- invitation id;
- sender username;
- scope type;
- row summary or group number;
- created timestamp.

### `POST /api/shares/invitations/:id/accept`

Accepts a pending invitation for the logged-in receiver.

Behavior:

- row scope creates `trip_row_access`;
- group scope creates `trip_group_access` for both sender and receiver if either membership row is missing;
- invitation status becomes `accepted`;
- response includes success and can include refreshed pending count.

### `POST /api/shares/invitations/:id/decline`

Declines a pending invitation for the logged-in receiver.

No access rows are created.

## Frontend Flow

### Table Sharing Indicator

Rows visible through sharing or shared with others get a visible shared indicator.

The indicator should be compact and scannable:

- label: `مشتركة`;
- group shared label: `مشتركة كمجموعة`;
- tooltip or small secondary text: owner username or share scope.

### Row Action Menu

The current share icon only copies details. Replace it with a small action menu so the meanings are clear:

- `نسخ التفاصيل`
- `مشاركة هذه الرحلة`
- `مشاركة المجموعة`

### Share Dialog

The share dialog contains:

- receiver username input or searchable existing account selector;
- scope selector for current row or current group number;
- confirmation summary before sending;
- success/error notification after sending.

### Invitations Panel

Add a pending invitations panel in the operations header or top navigation.

The entry point shows a count badge. The panel lists pending invitations with:

- sender username;
- row or group scope;
- group number;
- accept button;
- decline button.

Accepting or declining reloads rows, deleted rows, and pending invitations.

### Recycle Bin

The recycle bin shows private and shared deleted rows together.

For shared rows, show:

- shared indicator;
- owner username;
- deleted by username.

Restore calls the shared restore endpoint and restores the row for all collaborators.

### Sync Behavior

Initial load fetches:

- active rows;
- deleted rows;
- pending invitations;
- settings.

Inline edits use row-level persistence. The frontend can still keep `allRows` as local state, but row changes should persist through `PATCH /api/data/:id` or a row-aware debounce instead of full-table replacement.

Import and preview acceptance should create rows through the backend. If a row uses a shared `groupNo`, it automatically becomes visible to all collaborators with group access.

## Migration

Existing rows remain private rows owned by their current `user_id`.

Existing `settings.deleted_rows` are legacy private recycle-bin data. Moving forward, deleted rows should be canonical rows with `deleted_at`.

Migration strategy:

1. Add new sharing tables and deleted columns.
2. Preserve existing rows as owned private rows.
3. Continue reading legacy `settings.deleted_rows` until a user saves or restores/deletes through the new flow.
4. New deletes use canonical `logistics_rows.deleted_at`.

This keeps existing user data intact while enabling shared recycle-bin behavior for all new shared data.

## Testing

Backend behavior must be covered before implementation:

- User A can invite User B to a specific row.
- User B does not see the row while the invitation is pending.
- Declining keeps User B's table unchanged.
- Accepting makes User B see the row.
- User B edits the row, and User A sees the same updated row.
- User A shares group `123`; after User B accepts, existing group rows appear.
- User B creates or imports a future row with group `123`; User A sees it automatically.
- Deleting a shared row hides it from the normal table for all collaborators.
- Deleted shared row appears in the recycle bin for all collaborators.
- Any collaborator can restore the shared row for all collaborators.
- Unauthorized users cannot edit, delete, restore, or invite rows they cannot see.

Frontend tests can focus on integration boundaries:

- pending invitation count renders;
- accept/decline actions call the expected API methods and reload rows;
- shared row badge renders when `_sharing.shared` is true;
- share dialog submits row and group invitations;
- recycle bin renders shared delete metadata.

## Success Criteria

1. One account can invite another existing account to a single trip row.
2. One account can invite another existing account to a group number.
3. Pending invitations do not grant access until accepted.
4. Declining an invitation adds no rows or access.
5. Accepted row shares appear in the receiver's normal trip table.
6. Accepted group shares show existing rows for that group.
7. Future rows created or imported by any accepted group collaborator with the shared group number appear for all group collaborators.
8. Any accepted collaborator can edit visible shared rows.
9. Edits update the same canonical row and sync to all collaborators.
10. Deleting a shared row moves it to the recycle bin for all collaborators.
11. Any accepted collaborator can restore the deleted shared row for all collaborators.
12. Shared rows have a visible indicator in the normal table and recycle bin.
