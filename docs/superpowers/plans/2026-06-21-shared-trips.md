# Shared Trips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build invitation-controlled row and group sharing so multiple accounts collaborate on the same canonical trip records.

**Architecture:** Keep trip rows canonical in SQLite and add invitation/access tables around them. Backend visibility helpers drive `GET /api/data`, row updates, shared delete/restore, and group future-row access; the React UI consumes the new API through `services/api.ts` and keeps shared rows in the normal table with badges and invitation actions.

**Tech Stack:** Express 5, better-sqlite3, JWT auth, Vitest, Supertest, React 19, TypeScript, lucide-react, Vite.

## Global Constraints

- Use one canonical trip row record, not per-user copies.
- Share scopes are exactly `row` and `group`.
- Pending invitations do not grant access.
- Declined invitations do not create access.
- Accepted group shares apply to current and future rows with the same `groupNo`.
- Group access is membership: when a group invitation is accepted, both sender and receiver have group membership.
- Deleting a shared trip moves the same canonical row to the recycle bin for everyone with access.
- Any collaborator who can see a deleted shared row can restore it for everyone.
- Keep existing data intact during migration.
- Follow TDD for backend behavior: write the failing test, verify it fails, implement, verify it passes.

---

## File Structure

- Modify `server.ts`: schema migrations, row visibility helpers, invitation endpoints, row update/delete/restore endpoints, conservative sync behavior, ingest behavior that preserves shared rows.
- Modify `tests/server.test.ts`: sharing invitation, access, edit, future group row, delete/restore, and authorization tests.
- Modify `types.ts`: shared metadata and invitation TypeScript interfaces.
- Modify `services/api.ts`: methods for row update/create/delete/restore, deleted rows, invitations, and share creation.
- Modify `App.tsx`: load active/deleted/invitations, use row-level persistence for edits/deletes/restores, add share dialog and invitations panel state.
- Modify `components/TableEditor.tsx`: shared row badge, action menu with copy/share row/share group, shared metadata display.

---

### Task 1: Backend Schema And Row Sharing

**Files:**
- Modify: `tests/server.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Produces: `GET /api/data` returns active rows visible to the logged-in user with optional `_sharing`.
- Produces: `POST /api/shares/invitations` with `{ receiverUsername, scopeType, rowId?, groupNo? }`.
- Produces: `GET /api/shares/invitations`.
- Produces: `POST /api/shares/invitations/:id/accept`.
- Produces: `POST /api/shares/invitations/:id/decline`.

- [ ] **Step 1: Write failing row-invitation tests**

Add tests to `tests/server.test.ts`:

```typescript
describe('Shared trip row invitations', () => {
  const row = {
    id: 'shared-row-1',
    groupNo: 'S001',
    groupName: 'Shared Group',
    count: '4',
    Column1: 'وصول',
    date: '15/01/2026',
    time: '14:30',
    flight: 'SV123',
    from: 'جدة',
    to: 'مكة المكرمة',
    carType: 'سيدان',
    tafweej: 'Test',
    status: 'Planned',
  };

  const register = async (prefix: string) => {
    const credentials = { username: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`, password: 'pass123' };
    const res = await request(app).post('/api/auth/register').send(credentials);
    return { ...credentials, token: res.body.token, user: res.body.user };
  };

  it('keeps a row hidden until invite acceptance, then exposes the same canonical row', async () => {
    const owner = await register('share_owner');
    const receiver = await register('share_receiver');

    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${owner.token}`).send({ rows: [row] });

    const invite = await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });

    expect(invite.status).toBe(200);
    expect(invite.body.invitation.scopeType).toBe('row');

    const beforeAccept = await request(app).get('/api/data').set('Authorization', `Bearer ${receiver.token}`);
    expect(beforeAccept.body).toHaveLength(0);

    const pending = await request(app).get('/api/shares/invitations').set('Authorization', `Bearer ${receiver.token}`);
    expect(pending.body).toHaveLength(1);

    const accept = await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();
    expect(accept.status).toBe(200);

    const afterAccept = await request(app).get('/api/data').set('Authorization', `Bearer ${receiver.token}`);
    expect(afterAccept.body).toHaveLength(1);
    expect(afterAccept.body[0].id).toBe(row.id);
    expect(afterAccept.body[0]._sharing.shared).toBe(true);
    expect(afterAccept.body[0]._sharing.ownerUsername).toBe(owner.username);
  });

  it('declining a row invitation does not grant access', async () => {
    const owner = await register('decline_owner');
    const receiver = await register('decline_receiver');

    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${owner.token}`).send({ rows: [row] });
    await request(app)
      .post('/api/shares/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });

    const pending = await request(app).get('/api/shares/invitations').set('Authorization', `Bearer ${receiver.token}`);
    const decline = await request(app)
      .post(`/api/shares/invitations/${pending.body[0].id}/decline`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send();
    expect(decline.status).toBe(200);

    const rows = await request(app).get('/api/data').set('Authorization', `Bearer ${receiver.token}`);
    expect(rows.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server.test.ts -t "Shared trip row invitations"`

Expected: FAIL with 404 responses for `/api/shares/invitations`.

- [ ] **Step 3: Implement minimal schema and row invitation API**

In `server.ts`, add tables:

```typescript
CREATE TABLE IF NOT EXISTS trip_share_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL,
  receiver_user_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  row_id TEXT,
  group_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME,
  FOREIGN KEY (sender_user_id) REFERENCES users (id),
  FOREIGN KEY (receiver_user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS trip_row_access (
  row_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  granted_by_user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (row_id, user_id)
);

CREATE TABLE IF NOT EXISTS trip_group_access (
  group_no TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  granted_by_user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_no, user_id)
);
```

Add `deleted_at` and `deleted_by_user_id` migrations to `logistics_rows`.

Add helper functions:

```typescript
const parseRowData = (data: string) => JSON.parse(data);
const getUsernameById = (id: number) => (db.prepare("SELECT username FROM users WHERE id = ?").get(id) as any)?.username ?? null;
const userCanSeeRow = (userId: number, rowId: string) => Boolean(getVisibleRowForUser(userId, rowId, true));
```

Implement `GET /api/data` with active visible rows from owned rows, row access, and group access.

Implement invitation create/list/accept/decline endpoints for row scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server.test.ts -t "Shared trip row invitations"`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: add shared row invitations"
```

---

### Task 2: Backend Shared Editing And Group Future Rows

**Files:**
- Modify: `tests/server.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Consumes: invitation endpoints from Task 1.
- Produces: `PATCH /api/data/:id`.
- Produces: group invitation acceptance creates sender and receiver `trip_group_access`.
- Produces: future rows with accepted group `groupNo` are visible to group collaborators.

- [ ] **Step 1: Write failing edit and group tests**

Add tests:

```typescript
describe('Shared trip editing and group membership', () => {
  const register = async (prefix: string) => {
    const credentials = { username: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`, password: 'pass123' };
    const res = await request(app).post('/api/auth/register').send(credentials);
    return { ...credentials, token: res.body.token, user: res.body.user };
  };

  const makeRow = (id: string, groupNo = 'G123') => ({
    id,
    groupNo,
    groupName: 'Group 123',
    count: '4',
    Column1: 'وصول',
    date: '15/01/2026',
    time: '14:30',
    flight: 'SV123',
    from: 'جدة',
    to: 'مكة المكرمة',
    carType: 'سيدان',
    tafweej: 'Test',
    status: 'Planned',
  });

  it('lets an accepted row collaborator edit the canonical row for the owner', async () => {
    const owner = await register('edit_owner');
    const receiver = await register('edit_receiver');

    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${owner.token}`).send({ rows: [makeRow('edit-row-1')] });
    await request(app).post('/api/shares/invitations').set('Authorization', `Bearer ${owner.token}`).send({ receiverUsername: receiver.username, scopeType: 'row', rowId: 'edit-row-1' });
    const pending = await request(app).get('/api/shares/invitations').set('Authorization', `Bearer ${receiver.token}`);
    await request(app).post(`/api/shares/invitations/${pending.body[0].id}/accept`).set('Authorization', `Bearer ${receiver.token}`).send();

    const patch = await request(app)
      .patch('/api/data/edit-row-1')
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ updates: { status: 'Confirmed', notes: 'Updated by receiver' } });
    expect(patch.status).toBe(200);

    const ownerRows = await request(app).get('/api/data').set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRows.body.find((r: any) => r.id === 'edit-row-1').status).toBe('Confirmed');
    expect(ownerRows.body.find((r: any) => r.id === 'edit-row-1').notes).toBe('Updated by receiver');
  });

  it('shares current and future group rows created by any accepted collaborator', async () => {
    const owner = await register('group_owner');
    const receiver = await register('group_receiver');

    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${owner.token}`).send({ rows: [makeRow('group-row-1', '123')] });
    await request(app).post('/api/shares/invitations').set('Authorization', `Bearer ${owner.token}`).send({ receiverUsername: receiver.username, scopeType: 'group', groupNo: '123' });
    const pending = await request(app).get('/api/shares/invitations').set('Authorization', `Bearer ${receiver.token}`);
    await request(app).post(`/api/shares/invitations/${pending.body[0].id}/accept`).set('Authorization', `Bearer ${receiver.token}`).send();

    const receiverRows = await request(app).get('/api/data').set('Authorization', `Bearer ${receiver.token}`);
    expect(receiverRows.body.map((r: any) => r.id)).toContain('group-row-1');

    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${receiver.token}`).send({ rows: [makeRow('group-row-2', '123')] });

    const ownerRows = await request(app).get('/api/data').set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRows.body.map((r: any) => r.id)).toContain('group-row-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server.test.ts -t "Shared trip editing and group membership"`

Expected: FAIL because `PATCH /api/data/:id` and group access are not implemented.

- [ ] **Step 3: Implement editing and group membership**

Implement `PATCH /api/data/:id`:

```typescript
app.patch("/api/data/:id", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, false);
  if (!visible) return res.status(404).json({ error: "Trip not found" });
  const current = JSON.parse(visible.data);
  const updated = { ...current, ...req.body.updates, id: current.id };
  db.prepare("UPDATE logistics_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(updated), current.id);
  res.json({ success: true, row: decorateRowForUser(updated, req.user.id, visible.owner_user_id) });
});
```

Extend invitation creation and acceptance for `scopeType: 'group'`.

On group accept, insert both sender and receiver into `trip_group_access` with `INSERT OR IGNORE`.

Update `POST /api/data/sync` so it upserts incoming rows owned by the logged-in user or visible/editable to the logged-in user, but does not delete omitted rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server.test.ts -t "Shared trip editing and group membership"`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: sync shared group trip edits"
```

---

### Task 3: Backend Shared Delete, Restore, And Authorization

**Files:**
- Modify: `tests/server.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Produces: `GET /api/data/deleted`.
- Produces: `POST /api/data/:id/delete`.
- Produces: `POST /api/data/:id/restore`.

- [ ] **Step 1: Write failing recycle-bin and auth tests**

Add tests:

```typescript
describe('Shared trip delete and restore', () => {
  const register = async (prefix: string) => {
    const credentials = { username: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`, password: 'pass123' };
    const res = await request(app).post('/api/auth/register').send(credentials);
    return { ...credentials, token: res.body.token, user: res.body.user };
  };

  const row = {
    id: 'delete-shared-row-1',
    groupNo: 'DEL123',
    groupName: 'Delete Group',
    count: '4',
    Column1: 'وصول',
    date: '15/01/2026',
    time: '14:30',
    flight: 'SV123',
    from: 'جدة',
    to: 'مكة المكرمة',
    carType: 'سيدان',
    tafweej: 'Test',
    status: 'Planned',
  };

  it('moves a shared deleted row to every collaborator recycle bin and allows restore', async () => {
    const owner = await register('delete_owner');
    const receiver = await register('delete_receiver');

    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${owner.token}`).send({ rows: [row] });
    await request(app).post('/api/shares/invitations').set('Authorization', `Bearer ${owner.token}`).send({ receiverUsername: receiver.username, scopeType: 'row', rowId: row.id });
    const pending = await request(app).get('/api/shares/invitations').set('Authorization', `Bearer ${receiver.token}`);
    await request(app).post(`/api/shares/invitations/${pending.body[0].id}/accept`).set('Authorization', `Bearer ${receiver.token}`).send();

    const del = await request(app).post(`/api/data/${row.id}/delete`).set('Authorization', `Bearer ${receiver.token}`).send();
    expect(del.status).toBe(200);

    const ownerActive = await request(app).get('/api/data').set('Authorization', `Bearer ${owner.token}`);
    const receiverActive = await request(app).get('/api/data').set('Authorization', `Bearer ${receiver.token}`);
    expect(ownerActive.body.map((r: any) => r.id)).not.toContain(row.id);
    expect(receiverActive.body.map((r: any) => r.id)).not.toContain(row.id);

    const ownerDeleted = await request(app).get('/api/data/deleted').set('Authorization', `Bearer ${owner.token}`);
    const receiverDeleted = await request(app).get('/api/data/deleted').set('Authorization', `Bearer ${receiver.token}`);
    expect(ownerDeleted.body.map((r: any) => r.id)).toContain(row.id);
    expect(receiverDeleted.body.map((r: any) => r.id)).toContain(row.id);
    expect(ownerDeleted.body[0]._sharing.deletedByUsername).toBe(receiver.username);

    const restore = await request(app).post(`/api/data/${row.id}/restore`).set('Authorization', `Bearer ${owner.token}`).send();
    expect(restore.status).toBe(200);

    const receiverRestored = await request(app).get('/api/data').set('Authorization', `Bearer ${receiver.token}`);
    expect(receiverRestored.body.map((r: any) => r.id)).toContain(row.id);
  });

  it('blocks unauthorized users from editing, deleting, restoring, or inviting hidden rows', async () => {
    const owner = await register('auth_owner');
    const outsider = await register('auth_outsider');
    await request(app).post('/api/data/sync').set('Authorization', `Bearer ${owner.token}`).send({ rows: [row] });

    expect((await request(app).patch(`/api/data/${row.id}`).set('Authorization', `Bearer ${outsider.token}`).send({ updates: { status: 'Confirmed' } })).status).toBe(404);
    expect((await request(app).post(`/api/data/${row.id}/delete`).set('Authorization', `Bearer ${outsider.token}`).send()).status).toBe(404);
    expect((await request(app).post('/api/shares/invitations').set('Authorization', `Bearer ${outsider.token}`).send({ receiverUsername: owner.username, scopeType: 'row', rowId: row.id })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server.test.ts -t "Shared trip delete and restore"`

Expected: FAIL because deleted endpoints do not exist.

- [ ] **Step 3: Implement deleted visibility and mutations**

Add `GET /api/data/deleted`, `POST /api/data/:id/delete`, and `POST /api/data/:id/restore`.

Use the same visibility helper for deleted rows by allowing deleted lookup.

Decorate deleted rows with `_sharing.deletedByUsername`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server.test.ts -t "Shared trip delete and restore"`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: add shared trip recycle bin"
```

---

### Task 4: Frontend API Types

**Files:**
- Modify: `types.ts`
- Modify: `services/api.ts`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: backend endpoints from Tasks 1-3.
- Produces: `SharedMetadata`, `ShareInvitation`, and API methods for frontend components.

- [ ] **Step 1: Add types**

Add to `types.ts`:

```typescript
export interface SharedMetadata {
  shared: boolean;
  ownerUsername?: string;
  scope?: 'row' | 'group';
  deletedByUsername?: string;
  deletedAt?: string;
}

export interface LogisticsRow {
  ...
  _sharing?: SharedMetadata;
}

export interface ShareInvitation {
  id: number;
  senderUsername: string;
  scopeType: 'row' | 'group';
  rowId?: string;
  groupNo?: string;
  rowSummary?: string;
  createdAt: string;
}
```

- [ ] **Step 2: Add API client methods**

Add to `services/api.ts`:

```typescript
async fetchDeletedRows() { return api.request('/data/deleted'); }
async updateRow(id: string, updates: any) { return api.request(`/data/${id}`, { method: 'PATCH', body: JSON.stringify({ updates }) }); }
async deleteRow(id: string) { return api.request(`/data/${id}/delete`, { method: 'POST' }); }
async restoreRow(id: string) { return api.request(`/data/${id}/restore`, { method: 'POST' }); }
```

Add `shares` methods:

```typescript
shares: {
  async fetchInvitations() { return api.request('/shares/invitations'); },
  async createInvitation(payload: any) { return api.request('/shares/invitations', { method: 'POST', body: JSON.stringify(payload) }); },
  async acceptInvitation(id: number) { return api.request(`/shares/invitations/${id}/accept`, { method: 'POST' }); },
  async declineInvitation(id: number) { return api.request(`/shares/invitations/${id}/decline`, { method: 'POST' }); },
}
```

- [ ] **Step 3: Wire loading**

In `App.tsx`, load active rows, deleted rows, settings, and invitations in `loadUserData()`.

- [ ] **Step 4: Run type check**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add types.ts services/api.ts App.tsx
git commit -m "feat: add shared trips client api"
```

---

### Task 5: Frontend Sharing UI

**Files:**
- Modify: `App.tsx`
- Modify: `components/TableEditor.tsx`

**Interfaces:**
- Consumes: API methods and types from Task 4.
- Produces: visible shared badges, row/group share dialog, invitations panel, shared recycle-bin restore.

- [ ] **Step 1: Add TableEditor action callbacks**

Change `TableEditorProps`:

```typescript
onCopyRowDetails?: (row: LogisticsRow) => void;
onShareTripRow?: (row: LogisticsRow) => void;
onShareTripGroup?: (row: LogisticsRow) => void;
```

Render a compact action cluster:

```tsx
<button onClick={() => onCopyRowDetails?.(row)} title="نسخ التفاصيل"><Copy size={14} /></button>
<button onClick={() => onShareTripRow?.(row)} title="مشاركة هذه الرحلة"><Share2 size={14} /></button>
<button onClick={() => onShareTripGroup?.(row)} title="مشاركة المجموعة"><Users size={14} /></button>
```

- [ ] **Step 2: Add shared badge**

For rows with `row._sharing?.shared`, render `مشتركة` near the group or status cell with title showing owner/scope.

- [ ] **Step 3: Add App share dialog state and submit**

Add state:

```typescript
const [shareTarget, setShareTarget] = useState<{ row: LogisticsRow; scope: 'row' | 'group' } | null>(null);
const [shareReceiverUsername, setShareReceiverUsername] = useState('');
```

Submit:

```typescript
await api.shares.createInvitation({
  receiverUsername: shareReceiverUsername.trim(),
  scopeType: shareTarget.scope,
  rowId: shareTarget.scope === 'row' ? shareTarget.row.id : undefined,
  groupNo: shareTarget.scope === 'group' ? shareTarget.row.groupNo : undefined,
});
```

- [ ] **Step 4: Add invitations panel**

Render a button in the operations toolbar with pending count. The panel maps `shareInvitations` and calls accept/decline, then `loadUserData()`.

- [ ] **Step 5: Wire shared delete/restore**

Use `api.data.deleteRow(id)` in `softDeleteRow`, then reload data.

Use `api.data.restoreRow(id)` in recycle-bin restore actions, then reload data.

- [ ] **Step 6: Run verification**

Run:

```bash
npm run lint
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add App.tsx components/TableEditor.tsx
git commit -m "feat: add shared trips interface"
```

---

### Task 6: Full Verification

**Files:**
- No code changes unless verification exposes failures.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run type check**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: only unrelated pre-existing files remain dirty, or no unexpected files.

- [ ] **Step 5: Final commit if verification fixes were needed**

Run only if Step 1-3 required follow-up changes:

```bash
git add server.ts tests/server.test.ts types.ts services/api.ts App.tsx components/TableEditor.tsx
git commit -m "fix: complete shared trips verification"
```
