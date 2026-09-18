# Admin Dashboard & Super-Admin Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single seeded super-admin role with its own dashboard (users, companies, account/security activity) and remove public self-signup from the login page.

**Architecture:** Extend the existing single-file Express server (`server.ts`) with new `users` columns, two new tables (`companies`, `audit_log`), an admin bootstrap on boot, a `requireAdmin` middleware, and a set of `/api/admin/*` routes. On the frontend, branch at the top of `App.tsx`'s render (no router exists in this app) to a new self-contained `components/AdminDashboard.tsx` when `user.role === 'admin'`, backed by a new `admin` namespace in `services/api.ts`.

**Tech Stack:** Express, better-sqlite3, bcryptjs, jsonwebtoken (backend, unchanged deps); React 19 + TypeScript + Tailwind, lucide-react icons (frontend, unchanged deps). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-admin-dashboard-design.md`

## Global Constraints

- Single admin account only, seeded once at server startup from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars — no multi-admin invite flow.
- "Company" is an admin-side grouping label only — it must never be read by or wired into `getRowAccessForUser`, the `trip_row_access`/`trip_group_access`/`trip_agency_access` tables, or the free-text `agency` field on trip rows.
- Password reset from the admin dashboard is direct (admin types a new password, active immediately) — no temp-password/forced-change flow.
- Hard-deleting a user is refused (400) if they still own any `logistics_rows`. Hard-deleting a company is refused (400) if any user is still assigned to it. No cascade deletes.
- The audit log covers only account/security events (logins, user/company create/disable/enable/delete, password resets) — never full trip-data change history. Capped at the most recent 200 events, no pagination UI.
- No new npm dependencies (no router, no table/grid library, no email sending).

---

## Task 1: Schema migrations, admin bootstrap, and role/last_login_at in auth

**Files:**
- Modify: `server.ts:274-291` (add new migration + tables, insert admin bootstrap)
- Modify: `server.ts:417-441` (`authenticateToken` — fetch fresh role/is_active)
- Modify: `server.ts:780-825` (`authResponse`, register — unchanged for now, login updated)
- Modify: `vitest.config.ts` (add `ADMIN_USERNAME`/`ADMIN_PASSWORD` to test env)
- Modify: `.env.example` (document the two new env vars)
- Test: `tests/server.test.ts` (new describe block)

**Interfaces:**
- Produces: `users.role` (`'user' | 'admin'`, default `'user'`), `users.is_active` (`0 | 1`, default `1`), `users.company_id` (`INTEGER | NULL`), `users.last_login_at` (`DATETIME | NULL`); `companies` table (`id, name, created_at`); `audit_log` table (`id, event_type, actor_user_id, target_user_id, metadata, created_at`); `authResponse(user).user.role`; `req.user.role` set by `authenticateToken` on every authenticated request.
- Consumes: nothing new (builds on existing `db`, `bcrypt`, `normalizeUsername`/`isValidUsername`/`isValidPassword`, `authenticateToken`, `authResponse`, `POST /api/auth/login`, `POST /api/auth/register` — register endpoint is left in place for this task and removed in Task 5).

- [ ] **Step 1: Add the ADMIN_USERNAME/ADMIN_PASSWORD test env vars**

Edit `vitest.config.ts` — replace the whole file with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      VITEST: 'true',
      NODE_ENV: 'test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'AdminTestPassword123!',
    },
    globals: true,
    testTimeout: 15000,
  },
});
```

- [ ] **Step 2: Write the failing test**

In `tests/server.test.ts`, insert this new `describe` block right after the closing `});` of `describe('POST /api/auth/login', ...)` (the block that ends with the `'rejects an access token at the refresh endpoint'` test, at line 206) and before the `// ─────────────────────────────────────────────\n// Auth Middleware` comment:

```ts
// ─────────────────────────────────────────────
// Admin bootstrap
// ─────────────────────────────────────────────
describe('Admin bootstrap and role on login', () => {
  it('seeds a working admin account with role "admin"', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  it('defaults a newly registered user to role "user"', async () => {
    const unique = `roletest_${Date.now()}`;
    await request(app).post('/api/auth/register').send({ username: unique, password: 'Password123!' });
    const res = await request(app).post('/api/auth/login').send({ username: unique, password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/server.test.ts -t "Admin bootstrap"`
Expected: FAIL — `res.body.user.role` is `undefined` (no admin exists yet, login 401s or role is missing).

- [ ] **Step 4: Add the users-column migration and new tables**

In `server.ts`, insert this block right after the existing `// Migration: Add company_name / avatar to users if missing` block (ends at line 288 with the closing `}`) and before `app.disable("x-powered-by");` (line 291):

```ts
// Migration: Add role / is_active / company_id / last_login_at to users if missing
try {
  db.prepare("SELECT role, is_active, company_id, last_login_at FROM users LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration role failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration is_active failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN company_id INTEGER");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration company_id failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN last_login_at DATETIME");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration last_login_at failed", err);
  }
}

// New tables: companies (admin-side grouping label only, never used by row-sharing
// access control) and audit_log (account/security events for the admin dashboard).
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor_user_id INTEGER,
    target_user_id INTEGER,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
```

- [ ] **Step 5: Add the admin bootstrap**

In `server.ts`, insert this block right before the `// Auth Routes` comment (line 755), after the `isValidPassword`/`isValidAvatarDataUri` validator definitions:

```ts
// Admin bootstrap: seed the single super-admin account on first boot. Does not
// crash the server if the env vars are absent — an existing deployment without
// them should still start; it just has no admin account yet.
try {
  const existingAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!existingAdmin) {
    const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME);
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (isValidUsername(adminUsername) && isValidPassword(adminPassword)) {
      const hashedPassword = bcrypt.hashSync(adminPassword as string, 10);
      db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run(adminUsername, hashedPassword);
      console.log(`Seeded admin account "${adminUsername}"`);
    } else {
      console.warn("No admin account exists yet, and ADMIN_USERNAME/ADMIN_PASSWORD are missing or invalid (username 3-32 lowercase letters/digits/_/-, password 10-128 chars) — set them in .env and restart to create one.");
    }
  }
} catch (err) {
  console.error("Admin bootstrap failed", err);
}
```

- [ ] **Step 6: Include role in authResponse**

In `server.ts`, replace the `authResponse` function (lines 780-789):

```ts
const authResponse = (user: { id: number; username: string; company_name?: string | null; avatar?: string | null }) => ({
  token: signAuthToken(user),
  refreshToken: signRefreshToken(user),
  user: {
    id: Number(user.id),
    username: user.username,
    companyName: user.company_name ?? null,
    avatar: user.avatar ?? null,
  },
});
```

with:

```ts
const authResponse = (user: { id: number; username: string; company_name?: string | null; avatar?: string | null; role?: string }) => ({
  token: signAuthToken(user),
  refreshToken: signRefreshToken(user),
  user: {
    id: Number(user.id),
    username: user.username,
    companyName: user.company_name ?? null,
    avatar: user.avatar ?? null,
    role: user.role || 'user',
  },
});
```

- [ ] **Step 7: Update authenticateToken to fetch fresh role/is_active**

In `server.ts`, replace the `authenticateToken` middleware (lines 417-441):

```ts
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ["HS256"],
  }, (err: any, user: any) => {
    if (err) {
      const status = err.name === "TokenExpiredError" ? 401 : 403;
      return res.status(status).json({ error: status === 401 ? "Unauthorized" : "Forbidden" });
    }
    // The JWT payload can outlive the account it points to (deleted/recreated
    // user, restored-from-backup database, etc). A signature check alone lets
    // that stale id through, where it later blows up as a raw FOREIGN KEY
    // constraint failure on any write keyed by user_id. Reject it here as a
    // plain 401 so callers (e.g. the extension) treat it like an expired
    // session and re-authenticate instead of surfacing a DB error.
    const stillExists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(Number(user.id));
    if (!stillExists) return res.status(401).json({ error: "Unauthorized" });
    req.user = user;
    next();
  });
};
```

with:

```ts
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ["HS256"],
  }, (err: any, user: any) => {
    if (err) {
      const status = err.name === "TokenExpiredError" ? 401 : 403;
      return res.status(status).json({ error: status === 401 ? "Unauthorized" : "Forbidden" });
    }
    // The JWT payload can outlive the account it points to (deleted/recreated
    // user, restored-from-backup database, etc), or the account's current
    // role/active state (admin demoted, user disabled). A signature check
    // alone lets a stale id or stale role through, where a stale id later
    // blows up as a raw FOREIGN KEY constraint failure on any write keyed by
    // user_id. Re-check both fresh from the DB on every request instead of
    // trusting the JWT payload, so disabling a user or demoting an admin
    // takes effect on their very next request, not after their token expires.
    const current = db.prepare("SELECT role, is_active FROM users WHERE id = ?").get(Number(user.id)) as
      | { role: string; is_active: number }
      | undefined;
    if (!current || !current.is_active) return res.status(401).json({ error: "Unauthorized" });
    req.user = { ...user, role: current.role };
    next();
  });
};
```

- [ ] **Step 8: Update login to reject inactive users, record last_login_at, and log audit events**

In `server.ts`, replace the `POST /api/auth/login` handler (lines 813-824):

```ts
app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  if (!username || typeof password !== "string") return res.status(401).json({ error: "Invalid credentials" });
  const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.json(authResponse(user));
});
```

with:

```ts
app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  if (!username || typeof password !== "string") return res.status(401).json({ error: "Invalid credentials" });
  const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password)) || !user.is_active) {
    db.prepare(
      "INSERT INTO audit_log (event_type, actor_user_id, metadata) VALUES ('login_failure', ?, ?)"
    ).run(user ? user.id : null, JSON.stringify({ username }));
    return res.status(401).json({ error: "Invalid credentials" });
  }

  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  db.prepare("INSERT INTO audit_log (event_type, actor_user_id) VALUES ('login_success', ?)").run(user.id);

  res.json(authResponse(user));
});
```

- [ ] **Step 9: Document the new env vars**

Append to `.env.example`, right after the `JWT_AUDIENCE=umrah-logistics-web` line:

```
# Seeds the single super-admin account on first boot only (ignored once an
# admin account already exists). Username: 3-32 lowercase letters/digits/_/-.
# Password: 10-128 characters.
ADMIN_USERNAME=
ADMIN_PASSWORD=
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 11: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

```bash
git add server.ts vitest.config.ts .env.example tests/server.test.ts
git commit -m "feat: seed a super-admin account and carry role through auth"
```

---

## Task 2: requireAdmin middleware, overview, and audit log routes

**Files:**
- Modify: `server.ts:417-465` (add `requireAdmin` after `authenticateToken`)
- Modify: `server.ts:846-853` (add `// Admin Routes` section before `// Data Routes`)
- Modify: `tests/server.test.ts` (top-of-file `beforeAll`, new describe block)

**Interfaces:**
- Consumes: `authenticateToken` (Task 1, sets `req.user.role`), `db`, `audit_log`/`companies` tables (Task 1).
- Produces: `requireAdmin` middleware; `GET /api/admin/overview` → `{ totalUsers, activeUsers, totalCompanies, totalRows }`; `GET /api/admin/audit` → `{ events: Array<{ id, eventType, actorUserId, actorUsername, targetUserId, targetUsername, metadata, createdAt }> }`; module-level `adminToken` in `tests/server.test.ts`, reused by all later admin tests in that file.

- [ ] **Step 1: Write the failing tests**

In `tests/server.test.ts`, first add a module-level variable next to the existing ones near the top of the file (right after `let userId: number;`):

```ts
let adminToken = '';
```

Then replace the top-level `beforeAll` (the one that currently only registers `TEST_USER`):

```ts
beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send(TEST_USER);
  authToken = res.body.token;
  userId = res.body.user?.id;
});
```

with:

```ts
beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send(TEST_USER);
  authToken = res.body.token;
  userId = res.body.user?.id;

  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  adminToken = adminRes.body.token;
});
```

Then add this new `describe` block right after the `describe('Admin bootstrap and role on login', ...)` block added in Task 1:

```ts
describe('Admin route protection, overview, and audit log', () => {
  it('rejects admin routes with no token', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  it('rejects admin routes for a non-admin user', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(403);
  });

  it('returns overview counts for the admin', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      totalUsers: expect.any(Number),
      activeUsers: expect.any(Number),
      totalCompanies: expect.any(Number),
      totalRows: expect.any(Number),
    }));
  });

  it('records and returns login_success and login_failure audit events', async () => {
    await request(app).post('/api/auth/login').send({ username: TEST_USER.username, password: 'wrong-password' });
    await request(app).post('/api/auth/login').send(TEST_USER);

    const res = await request(app)
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const types = res.body.events.map((e: any) => e.eventType);
    expect(types).toContain('login_success');
    expect(types).toContain('login_failure');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server.test.ts -t "Admin route protection"`
Expected: FAIL — 404s, since `/api/admin/overview` and `/api/admin/audit` don't exist yet.

- [ ] **Step 3: Add requireAdmin middleware**

In `server.ts`, right after the `authenticateToken` middleware's closing `};` (end of Task 1's Step 7 edit) and before `type LogisticsRowRecord = {`, add:

```ts
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
};
```

- [ ] **Step 4: Add the overview and audit routes**

In `server.ts`, right after the `app.post("/api/auth/refresh", ...)` handler's closing `});` (line 852) and before the `// Data Routes` comment (line 854), add:

```ts
// Admin Routes
app.get("/api/admin/overview", authenticateToken, requireAdmin, (req, res) => {
  const totalUsers = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const activeUsers = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_active = 1").get() as { count: number }).count;
  const totalCompanies = (db.prepare("SELECT COUNT(*) AS count FROM companies").get() as { count: number }).count;
  const totalRows = (db.prepare("SELECT COUNT(*) AS count FROM logistics_rows WHERE deleted_at IS NULL").get() as { count: number }).count;
  res.json({ totalUsers, activeUsers, totalCompanies, totalRows });
});

app.get("/api/admin/audit", authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      a.id,
      a.event_type AS eventType,
      a.actor_user_id AS actorUserId,
      actor.username AS actorUsername,
      a.target_user_id AS targetUserId,
      target.username AS targetUsername,
      a.metadata,
      a.created_at AS createdAt
    FROM audit_log a
    LEFT JOIN users actor ON actor.id = a.actor_user_id
    LEFT JOIN users target ON target.id = a.target_user_id
    ORDER BY a.id DESC
    LIMIT 200
  `).all() as any[];

  res.json({
    events: rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })),
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS — full file, including all pre-existing tests (confirms the `beforeAll` change didn't break anything).

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: add requireAdmin middleware and admin overview/audit routes"
```

---

## Task 3: Admin user-management routes

**Files:**
- Modify: `server.ts` (insert routes right after Task 2's `GET /api/admin/audit`, before `// Data Routes`)
- Modify: `tests/server.test.ts` (new describe block)

**Interfaces:**
- Consumes: `requireAdmin`, `authenticateToken`, `normalizeUsername`/`isValidUsername`/`isValidPassword` (existing, `server.ts:468-470`), `db`, `bcrypt`.
- Produces:
  - `GET /api/admin/users` → `{ users: Array<{ id, username, role, isActive, companyId, companyName, createdAt, lastLoginAt }> }`
  - `POST /api/admin/users` body `{ username, password, companyId? }` → `201 { user: {...same shape} }` or `400 { error }`
  - `PATCH /api/admin/users/:id` body `{ companyId?, isActive? }` → `200 { user: {...same shape} }`, `404` if missing
  - `POST /api/admin/users/:id/reset-password` body `{ password }` → `200 { success: true }`
  - `DELETE /api/admin/users/:id` → `200 { success: true }`, `400` if self or still owns rows, `404` if missing

- [ ] **Step 1: Write the failing tests**

In `tests/server.test.ts`, add this new `describe` block right after the `describe('Admin route protection, overview, and audit log', ...)` block from Task 2:

```ts
describe('Admin user management', () => {
  let createdUserId: number;
  let createdUsername: string;

  it('creates a new user via the admin endpoint', async () => {
    createdUsername = `admincreated_${Date.now()}`;
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: createdUsername, password: 'Password123!' });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(createdUsername);
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.isActive).toBe(true);
    createdUserId = res.body.user.id;
  });

  it('rejects duplicate username with 400', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(TEST_USER);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects missing username or password with 400', async () => {
    const res1 = await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).send({ password: 'Password123!' });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).send({ username: 'someuser' });
    expect(res2.status).toBe(400);
  });

  it('rejects creating a user as a non-admin', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ username: `blocked_${Date.now()}`, password: 'Password123!' });
    expect(res.status).toBe(403);
  });

  it('lists users including the newly created one', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.some((u: any) => u.id === createdUserId)).toBe(true);
  });

  it("resets a user's password and the user can log in with the new one", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${createdUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'NewPassword456!' });
    expect(res.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: createdUsername, password: 'NewPassword456!' });
    expect(login.status).toBe(200);
  });

  it('disables a user, blocking both their login and their existing token, then re-enables them', async () => {
    const loginBeforeDisable = await request(app)
      .post('/api/auth/login')
      .send({ username: createdUsername, password: 'NewPassword456!' });
    const tokenIssuedBeforeDisable = loginBeforeDisable.body.token as string;

    const disable = await request(app)
      .patch(`/api/admin/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(disable.status).toBe(200);
    expect(disable.body.user.isActive).toBe(false);

    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: createdUsername, password: 'NewPassword456!' });
    expect(blockedLogin.status).toBe(401);

    // The token issued before disabling must also stop working immediately,
    // not just future logins (authenticateToken re-checks is_active per request).
    const blockedApiCall = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${tokenIssuedBeforeDisable}`);
    expect(blockedApiCall.status).toBe(401);

    const enable = await request(app)
      .patch(`/api/admin/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true });
    expect(enable.status).toBe(200);
    expect(enable.body.user.isActive).toBe(true);
  });

  it('refuses to delete a user who still owns trip rows, then allows it once rows are gone', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: createdUsername, password: 'NewPassword456!' });
    const createdUserToken = login.body.token as string;

    const row = {
      id: `admin-delete-test-${Date.now()}`,
      groupNo: 'ADMIN001',
      groupName: 'Admin Delete Test',
      agency: 'Admin Test Agency',
      count: '1',
      Column1: 'وصول',
      date: '15/01/2026',
      time: '14:30',
      flight: 'SV999',
      route: 'JED-MED',
      status: 'Planned',
    };
    await request(app)
      .post('/api/data/sync')
      .set('Authorization', `Bearer ${createdUserToken}`)
      .send({ rows: [row] });

    const blocked = await request(app)
      .delete(`/api/admin/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/owns trip rows/i);

    await request(app)
      .post(`/api/data/${row.id}/delete`)
      .set('Authorization', `Bearer ${createdUserToken}`);
    await request(app)
      .delete(`/api/data/${row.id}`)
      .set('Authorization', `Bearer ${createdUserToken}`);

    const deleted = await request(app)
      .delete(`/api/admin/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
  });

  it('refuses to delete your own (the admin) account', async () => {
    const meRes = await request(app)
      .post('/api/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
    const adminUserId = meRes.body.user.id;

    const res = await request(app)
      .delete(`/api/admin/users/${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server.test.ts -t "Admin user management"`
Expected: FAIL — 404s, none of the `/api/admin/users*` routes exist yet.

- [ ] **Step 3: Implement the routes**

In `server.ts`, right after Task 2's `GET /api/admin/audit` handler and before `// Data Routes`, add:

```ts
app.get("/api/admin/users", authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.role,
      u.is_active AS isActive,
      u.company_id AS companyId,
      c.name AS companyName,
      u.created_at AS createdAt,
      u.last_login_at AS lastLoginAt
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    ORDER BY u.created_at DESC
  `).all() as any[];
  res.json({ users: rows.map((r) => ({ ...r, isActive: !!r.isActive })) });
});

app.post("/api/admin/users", authenticateToken, requireAdmin, async (req: any, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  const companyId = req.body?.companyId ?? null;

  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-32 lowercase letters, numbers, underscores, or hyphens" });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 10-128 characters" });
  if (companyId !== null) {
    const company = db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId);
    if (!company) return res.status(400).json({ error: "Company not found" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const info = db.prepare("INSERT INTO users (username, password, company_id) VALUES (?, ?, ?)").run(username, hashedPassword, companyId);
    const userId = Number(info.lastInsertRowid);

    db.prepare("INSERT INTO audit_log (event_type, actor_user_id, target_user_id) VALUES ('user_created', ?, ?)").run(req.user.id, userId);

    const created = db.prepare(`
      SELECT u.id, u.username, u.role, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName, u.created_at AS createdAt, u.last_login_at AS lastLoginAt
      FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?
    `).get(userId) as any;
    res.status(201).json({ user: { ...created, isActive: !!created.isActive } });
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      res.status(400).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

app.patch("/api/admin/users/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const userId = Number(req.params.id);
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "companyId")) {
    const companyId = req.body.companyId;
    if (companyId !== null) {
      const company = db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId);
      if (!company) return res.status(400).json({ error: "Company not found" });
    }
    db.prepare("UPDATE users SET company_id = ? WHERE id = ?").run(companyId, userId);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) {
    const isActive = req.body.isActive ? 1 : 0;
    db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(isActive, userId);
    db.prepare(
      "INSERT INTO audit_log (event_type, actor_user_id, target_user_id) VALUES (?, ?, ?)"
    ).run(isActive ? "user_enabled" : "user_disabled", req.user.id, userId);
  }

  const updated = db.prepare(`
    SELECT u.id, u.username, u.role, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName, u.created_at AS createdAt, u.last_login_at AS lastLoginAt
    FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?
  `).get(userId) as any;
  res.json({ user: { ...updated, isActive: !!updated.isActive } });
});

app.post("/api/admin/users/:id/reset-password", authenticateToken, requireAdmin, async (req: any, res) => {
  const userId = Number(req.params.id);
  const { password } = req.body;
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 10-128 characters" });

  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  const hashedPassword = await bcrypt.hash(password, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, userId);
  db.prepare("INSERT INTO audit_log (event_type, actor_user_id, target_user_id) VALUES ('user_password_reset', ?, ?)").run(req.user.id, userId);

  res.json({ success: true });
});

app.delete("/api/admin/users/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const userId = Number(req.params.id);
  if (userId === Number(req.user.id)) return res.status(400).json({ error: "Cannot delete your own account" });

  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  const ownsRows = db.prepare("SELECT 1 FROM logistics_rows WHERE user_id = ? LIMIT 1").get(userId);
  if (ownsRows) return res.status(400).json({ error: "Cannot delete a user that still owns trip rows" });

  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  db.prepare("INSERT INTO audit_log (event_type, actor_user_id, target_user_id) VALUES ('user_deleted', ?, ?)").run(req.user.id, userId);

  res.json({ success: true });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS — full file.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: add admin user create/list/update/reset-password/delete routes"
```

---

## Task 4: Admin company-management routes

**Files:**
- Modify: `server.ts` (insert routes right after Task 3's user routes, before `// Data Routes`)
- Modify: `tests/server.test.ts` (new describe block)

**Interfaces:**
- Consumes: `requireAdmin`, `authenticateToken`, `db`; `POST /api/admin/users` and `PATCH /api/admin/users/:id` (Task 3, for the users-with-a-company test).
- Produces:
  - `GET /api/admin/companies` → `{ companies: Array<{ id, name, userCount, createdAt }> }`
  - `POST /api/admin/companies` body `{ name }` → `201 { company: { id, name, userCount: 0, createdAt } }` or `400 { error }`
  - `PATCH /api/admin/companies/:id` body `{ name }` → `200 { company: { id, name, userCount } }`, `404` if missing
  - `DELETE /api/admin/companies/:id` → `200 { success: true }`, `400` if users assigned, `404` if missing

- [ ] **Step 1: Write the failing tests**

In `tests/server.test.ts`, add this new `describe` block right after the `describe('Admin user management', ...)` block from Task 3:

```ts
describe('Admin company management', () => {
  let companyId: number;

  it('creates a company', async () => {
    const res = await request(app)
      .post('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Test Travel Co ${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.company.userCount).toBe(0);
    companyId = res.body.company.id;
  });

  it('rejects an empty company name', async () => {
    const res = await request(app)
      .post('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '  ' });
    expect(res.status).toBe(400);
  });

  it('lists companies including the newly created one', async () => {
    const res = await request(app)
      .get('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.companies.some((c: any) => c.id === companyId)).toBe(true);
  });

  it('renames a company', async () => {
    const newName = `Renamed Co ${Date.now()}`;
    const res = await request(app)
      .patch(`/api/admin/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe(newName);
  });

  it('assigns a user to the company, blocks deleting the company, then allows it once unassigned', async () => {
    const unique = `companyuser_${Date.now()}`;
    const create = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: unique, password: 'Password123!', companyId });
    expect(create.status).toBe(201);
    expect(create.body.user.companyId).toBe(companyId);

    const blocked = await request(app)
      .delete(`/api/admin/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blocked.status).toBe(400);

    const unassign = await request(app)
      .patch(`/api/admin/users/${create.body.user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyId: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.user.companyId).toBeNull();

    const deleted = await request(app)
      .delete(`/api/admin/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
  });

  it('rejects an unknown companyId when creating a user', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `badcompany_${Date.now()}`, password: 'Password123!', companyId: 999999 });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server.test.ts -t "Admin company management"`
Expected: FAIL — 404s, none of the `/api/admin/companies*` routes exist yet.

- [ ] **Step 3: Implement the routes**

In `server.ts`, right after Task 3's `DELETE /api/admin/users/:id` handler and before `// Data Routes`, add:

```ts
app.get("/api/admin/companies", authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.created_at AS createdAt, COUNT(u.id) AS userCount
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all();
  res.json({ companies: rows });
});

app.post("/api/admin/companies", authenticateToken, requireAdmin, (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Company name is required" });

  try {
    const info = db.prepare("INSERT INTO companies (name) VALUES (?)").run(name);
    const companyId = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO audit_log (event_type, actor_user_id, metadata) VALUES ('company_created', ?, ?)").run(req.user.id, JSON.stringify({ companyId, name }));
    res.status(201).json({ company: { id: companyId, name, userCount: 0, createdAt: new Date().toISOString() } });
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      res.status(400).json({ error: "A company with that name already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

app.patch("/api/admin/companies/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const companyId = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Company name is required" });

  const existing = db.prepare("SELECT id FROM companies WHERE id = ?").get(companyId);
  if (!existing) return res.status(404).json({ error: "Company not found" });

  try {
    db.prepare("UPDATE companies SET name = ? WHERE id = ?").run(name, companyId);
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      return res.status(400).json({ error: "A company with that name already exists" });
    }
    return res.status(500).json({ error: "Server error" });
  }

  db.prepare("INSERT INTO audit_log (event_type, actor_user_id, metadata) VALUES ('company_renamed', ?, ?)").run(req.user.id, JSON.stringify({ companyId, name }));

  const userCount = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ?").get(companyId) as { count: number }).count;
  res.json({ company: { id: companyId, name, userCount } });
});

app.delete("/api/admin/companies/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const companyId = Number(req.params.id);
  const existing = db.prepare("SELECT id, name FROM companies WHERE id = ?").get(companyId) as { id: number; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "Company not found" });

  const hasUsers = db.prepare("SELECT 1 FROM users WHERE company_id = ? LIMIT 1").get(companyId);
  if (hasUsers) return res.status(400).json({ error: "Cannot delete a company with assigned users" });

  db.prepare("DELETE FROM companies WHERE id = ?").run(companyId);
  db.prepare("INSERT INTO audit_log (event_type, actor_user_id, metadata) VALUES ('company_deleted', ?, ?)").run(req.user.id, JSON.stringify({ companyId, name: existing.name }));

  res.json({ success: true });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS — full file.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

```bash
git add server.ts tests/server.test.ts
git commit -m "feat: add admin company create/list/rename/delete routes"
```

---

## Task 5: Remove self-signup end-to-end

**Files:**
- Modify: `server.ts` (delete `POST /api/auth/register`)
- Modify: `components/Auth.tsx` (full rewrite — drop the register UI/branch)
- Modify: `services/api.ts` (drop `auth.register`)
- Modify: `tests/server.test.ts` (introduce `registerTestUser` helper, rewrite every call site, delete the old register-endpoint describe block)
- Modify: `tests/consistency.test.ts` (rewrite `registerUser` helper)

**Interfaces:**
- Consumes: `POST /api/admin/users` + `POST /api/auth/login` (Task 3) as the replacement bootstrap path for test users.
- Produces: `registerTestUser(credentials)` in `tests/server.test.ts` — returns a supertest-`Response`-shaped object (`{ status, body: { token, user } }` on success, or the raw `400` response from `POST /api/admin/users` on validation failure), a drop-in replacement for the old `request(app).post('/api/auth/register').send(credentials)` call sites.

- [ ] **Step 1: Write the failing test for route removal**

In `tests/server.test.ts`, replace the entire `describe('POST /api/auth/register', ...)` block (the one with 5 `it` blocks: "creates a new user...", "rejects duplicate username...", "rejects missing username...", "rejects missing password...", "rejects empty body...") with:

```ts
// ─────────────────────────────────────────────
// POST /api/auth/register (removed — see Admin user management)
// ─────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('no longer exists; new users are created via POST /api/admin/users', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'someone', password: 'Password123!' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server.test.ts -t "no longer exists"`
Expected: FAIL — the route still exists and returns 200/400, not 404.

- [ ] **Step 3: Delete the register endpoint from server.ts**

In `server.ts`, delete this entire block (currently right before `app.post("/api/auth/login", ...)`):

```ts
app.post("/api/auth/register", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-32 lowercase letters, numbers, underscores, or hyphens" });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 10-128 characters" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    const info = stmt.run(username, hashedPassword);

    const userId = Number(info.lastInsertRowid);
    res.json(authResponse({ id: userId, username }));
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      res.status(400).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

```

(Leave the blank line before `app.post("/api/auth/login", ...)` as-is.)

- [ ] **Step 4: Add the registerTestUser helper and fix every remaining call site in tests/server.test.ts**

Add this helper right after the `authGet`/`authPost` helper definitions (before `startLiveTestServer`):

```ts
// Self-signup is gone; bootstrap test users the same way the admin dashboard
// does — create via the admin endpoint, then log in as them. Returns a
// supertest-Response-shaped object so it's a drop-in for the old
// `request(app).post('/api/auth/register').send(credentials)` call sites.
const registerTestUser = async (credentials: { username?: string; password?: string }) => {
  const createRes = await request(app)
    .post('/api/admin/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(credentials);
  if (createRes.status !== 201) return createRes;
  return request(app).post('/api/auth/login').send(credentials);
};
```

Then update the top-level `beforeAll` (already modified once in Task 2 to also log in as admin) so `TEST_USER` is bootstrapped the same way — replace:

```ts
beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send(TEST_USER);
  authToken = res.body.token;
  userId = res.body.user?.id;

  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  adminToken = adminRes.body.token;
});
```

with:

```ts
beforeAll(async () => {
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  adminToken = adminRes.body.token;

  const res = await registerTestUser(TEST_USER);
  authToken = res.body.token;
  userId = res.body.user?.id;
});
```

Then replace each of the following remaining direct register calls (search the file for `'/api/auth/register'` — six should remain after Step 1's block was already replaced):

In the `'preserves companyName and avatar set via /api/account after a fresh login'` test:
- Replace `const reg = await request(app).post('/api/auth/register').send(user);` with `const reg = await registerTestUser(user);`

In the `'issues expiring JWTs'` test (under `describe('Security limits', ...)`):
- Replace:
  ```ts
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: unique, password: 'Password123!' });
  ```
  with:
  ```ts
      const res = await registerTestUser({ username: unique, password: 'Password123!' });
  ```

In the `'data is user-isolated: another user does not see these rows'` test:
- Replace `const regRes = await request(app).post('/api/auth/register').send(user2);` with `const regRes = await registerTestUser(user2);`

In the `'returns default settings for new user'` test:
- Replace `const reg = await request(app).post('/api/auth/register').send(newUser);` with `const reg = await registerTestUser(newUser);`

In the `'defaults fontSize to 100 when not provided'` test:
- Replace `const reg = await request(app).post('/api/auth/register').send(fresh);` with `const reg = await registerTestUser(fresh);`

In the `'settings are user-isolated'` test:
- Replace `const reg = await request(app).post('/api/auth/register').send(fresh);` with `const reg = await registerTestUser(fresh);`

In the local `registerFresh` helper inside `describe('PATCH /api/account', ...)`:
- Replace:
  ```ts
    const registerFresh = async () => {
      const user = { username: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, password: 'Password123!' };
      const reg = await request(app).post('/api/auth/register').send(user);
      return { user, token: reg.body.token as string, userId: reg.body.user.id as number };
    };
  ```
  with:
  ```ts
    const registerFresh = async () => {
      const user = { username: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, password: 'Password123!' };
      const reg = await registerTestUser(user);
      return { user, token: reg.body.token as string, userId: reg.body.user.id as number };
    };
  ```

In the `registerSharedTestUser` helper (under the `// Shared Trips` section):
- Replace:
  ```ts
  const registerSharedTestUser = async (prefix: string) => {
    const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 8) || 'user';
    const suffix = Math.random().toString(36).slice(2, 10);
    const credentials = {
      username: `${safePrefix}_${suffix}`,
      password: 'Password123!',
    };
    const res = await request(app).post('/api/auth/register').send(credentials);
    return { ...credentials, token: res.body.token, user: res.body.user };
  };
  ```
  with:
  ```ts
  const registerSharedTestUser = async (prefix: string) => {
    const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 8) || 'user';
    const suffix = Math.random().toString(36).slice(2, 10);
    const credentials = {
      username: `${safePrefix}_${suffix}`,
      password: 'Password123!',
    };
    const res = await registerTestUser(credentials);
    return { ...credentials, token: res.body.token, user: res.body.user };
  };
  ```

- [ ] **Step 5: Fix tests/consistency.test.ts**

Replace the `registerUser` helper:

```ts
const registerUser = async (prefix: string) => {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 8) || 'user';
  const suffix = Math.random().toString(36).slice(2, 10);
  const credentials = { username: `${safePrefix}_${suffix}`, password: 'Password123!' };
  const res = await request(app).post('/api/auth/register').send(credentials);
  return { ...credentials, token: res.body.token, user: res.body.user };
};
```

with:

```ts
let adminToken = '';
const getAdminToken = async () => {
  if (adminToken) return adminToken;
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  adminToken = res.body.token;
  return adminToken;
};

const registerUser = async (prefix: string) => {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 8) || 'user';
  const suffix = Math.random().toString(36).slice(2, 10);
  const credentials = { username: `${safePrefix}_${suffix}`, password: 'Password123!' };
  const token = await getAdminToken();
  await request(app)
    .post('/api/admin/users')
    .set('Authorization', `Bearer ${token}`)
    .send(credentials);
  const res = await request(app).post('/api/auth/login').send(credentials);
  return { ...credentials, token: res.body.token, user: res.body.user };
};
```

- [ ] **Step 6: Remove the register UI from Auth.tsx**

Replace the entire contents of `components/Auth.tsx` with:

```tsx
import React, { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { api } from '../services/api';

interface AuthProps {
  onLogin: (user: any) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await api.auth.login({ username, password });
      onLogin(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4 font-['Tajawal']" dir="rtl">
      <a href="/home" className="mb-2" title="الصفحة الرئيسية">
        <img src="/assets/logo-icon.png" alt="UM Track" className="h-14 w-auto" />
      </a>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">UM Track</h1>
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100">
        <div className="bg-gradient-to-l from-gray-900 via-gray-800 to-gray-800 border-b border-gold-700/40 p-8 text-white text-center">
          <p className="text-gold-200 text-sm">سجل دخولك للوصول إلى بياناتك من أي مكان</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold border border-red-100 animate-shake">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">اسم المستخدم</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
                placeholder="أدخل اسم المستخدم"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">كلمة المرور</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-gold-600 text-white p-4 rounded-2xl font-bold hover:bg-gold-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-gold-100 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <>
                <LogIn size={20} />
                تسجيل الدخول
              </>
            )}
          </button>

          <div className="text-center pt-2 border-t border-gray-100">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              سياسة الخصوصية · Privacy Policy
            </a>
          </div>
        </form>
      </div>
    </div>
  );
};
```

- [ ] **Step 7: Remove the dead register client method from services/api.ts**

In `services/api.ts`, delete this method from the `auth` object (right after `login`, before `logout`):

```ts
    async register(credentials: any) {
      const data = await api.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      localStorage.setItem('umrah_auth_token', data.token);
      localStorage.setItem('umrah_user', JSON.stringify(data.user));
      return data.user;
    },
```

- [ ] **Step 8: Run the full test suite to verify everything passes**

Run: `npm test`
Expected: PASS — every test file, including `tests/server.test.ts` and `tests/consistency.test.ts`.

- [ ] **Step 9: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

```bash
git add server.ts components/Auth.tsx services/api.ts tests/server.test.ts tests/consistency.test.ts
git commit -m "feat: remove self-signup; all new users are created by the admin"
```

---

## Task 6: Admin dashboard frontend

**Files:**
- Modify: `types.ts` (add `role` to `UserAccount`, add `AdminUser`/`AdminCompany`/`AdminAuditEvent`)
- Modify: `services/api.ts` (add `admin` namespace)
- Modify: `App.tsx` (import + role branch + skip `loadUserData` for admin)
- Create: `components/AdminDashboard.tsx`

**Interfaces:**
- Consumes: `api.admin.*` (this task, in `services/api.ts`), `AdminUser`/`AdminCompany`/`AdminAuditEvent` (this task, in `types.ts`), all `/api/admin/*` routes (Tasks 2-4).
- Produces: `<AdminDashboard user={user} />` component, rendered from `App.tsx` when `user.role === 'admin'`.

No automated test for this task — the project has no React component test framework (confirmed: only `tests/*.test.ts` files, all backend/logic, `vitest.config.ts` uses `environment: 'node'`). Verification is `npx tsc --noEmit` plus a manual smoke check (Step 6 below).

- [ ] **Step 1: Add types**

In `types.ts`, replace:

```ts
export interface UserAccount {
  id: number;
  username: string;
  companyName: string | null;
  avatar: string | null;
}
```

with:

```ts
export interface UserAccount {
  id: number;
  username: string;
  companyName: string | null;
  avatar: string | null;
  role?: 'user' | 'admin';
}

export interface AdminUser {
  id: number;
  username: string;
  role: 'user' | 'admin';
  isActive: boolean;
  companyId: number | null;
  companyName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminCompany {
  id: number;
  name: string;
  userCount: number;
  createdAt: string;
}

export interface AdminAuditEvent {
  id: number;
  eventType: string;
  actorUserId: number | null;
  actorUsername: string | null;
  targetUserId: number | null;
  targetUsername: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
```

- [ ] **Step 2: Add the admin namespace to services/api.ts**

In `services/api.ts`, add this new top-level key to the exported `api` object, right after the `telegram` block (before the final closing `};` of the file):

```ts
  admin: {
    async overview() {
      return api.request('/admin/overview');
    },
    async listUsers() {
      return api.request('/admin/users');
    },
    async createUser(payload: { username: string; password: string; companyId?: number | null }) {
      return api.request('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    async updateUser(id: number, payload: { companyId?: number | null; isActive?: boolean }) {
      return api.request(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    async resetPassword(id: number, password: string) {
      return api.request(`/admin/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },
    async deleteUser(id: number) {
      return api.request(`/admin/users/${id}`, {
        method: 'DELETE',
      });
    },
    async listCompanies() {
      return api.request('/admin/companies');
    },
    async createCompany(name: string) {
      return api.request('/admin/companies', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    },
    async updateCompany(id: number, name: string) {
      return api.request(`/admin/companies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
    },
    async deleteCompany(id: number) {
      return api.request(`/admin/companies/${id}`, {
        method: 'DELETE',
      });
    },
    async listAuditLog() {
      return api.request('/admin/audit');
    }
  }
```

Note: this is the last key in the object, so make sure a comma is added after the `telegram: { ... }` block's closing `}` (there currently is none, since `telegram` is last).

- [ ] **Step 3: Create components/AdminDashboard.tsx**

Create `components/AdminDashboard.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Users, Building2, Activity, Plus, KeyRound, Ban, CheckCircle2, Trash2, LogOut, Loader2, X } from 'lucide-react';
import { api } from '../services/api';
import type { AdminUser, AdminCompany, AdminAuditEvent } from '../types';

interface AdminDashboardProps {
  user: any;
}

type Tab = 'users' | 'companies' | 'activity';

const EVENT_LABELS: Record<string, string> = {
  login_success: 'تسجيل دخول ناجح',
  login_failure: 'محاولة تسجيل دخول فاشلة',
  user_created: 'إنشاء مستخدم',
  user_password_reset: 'إعادة تعيين كلمة مرور',
  user_disabled: 'تعطيل مستخدم',
  user_enabled: 'تفعيل مستخدم',
  user_deleted: 'حذف مستخدم',
  company_created: 'إنشاء شركة',
  company_renamed: 'إعادة تسمية شركة',
  company_deleted: 'حذف شركة',
};

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">{title}</h3>
        <button onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>
);

const CreateUserModal: React.FC<{ companies: AdminCompany[]; onClose: () => void; onCreated: () => void }> = ({ companies, onClose, onCreated }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [companyId, setCompanyId] = useState<string>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.createUser({ username, password, companyId: companyId ? Number(companyId) : null });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء المستخدم');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إضافة مستخدم" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">الشركة (اختياري)</label>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500">
            <option value="">بدون شركة</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'إنشاء'}
        </button>
      </form>
    </ModalShell>
  );
};

const CreateCompanyModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.createCompany(name);
      onCreated();
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء الشركة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إضافة شركة" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">اسم الشركة</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'إنشاء'}
        </button>
      </form>
    </ModalShell>
  );
};

const ResetPasswordModal: React.FC<{ userId: number; onClose: () => void; onDone: () => void }> = ({ userId, onClose, onDone }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.resetPassword(userId, password);
      onDone();
    } catch (err: any) {
      setError(err.message || 'فشل إعادة تعيين كلمة المرور');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إعادة تعيين كلمة المرور" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">كلمة المرور الجديدة</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'حفظ'}
        </button>
      </form>
    </ModalShell>
  );
};

const RenameCompanyModal: React.FC<{ company: AdminCompany; onClose: () => void; onDone: () => void }> = ({ company, onClose, onDone }) => {
  const [name, setName] = useState(company.name);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.updateCompany(company.id, name);
      onDone();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث الشركة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إعادة تسمية الشركة" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">اسم الشركة</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'حفظ'}
        </button>
      </form>
    </ModalShell>
  );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user }) => {
  const [tab, setTab] = useState<Tab>('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<{ totalUsers: number; activeUsers: number; totalCompanies: number; totalRows: number } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<number | null>(null);
  const [renameCompanyId, setRenameCompanyId] = useState<number | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, usersRes, companiesRes, auditRes] = await Promise.all([
        api.admin.overview(),
        api.admin.listUsers(),
        api.admin.listCompanies(),
        api.admin.listAuditLog(),
      ]);
      setOverview(overviewRes);
      setUsers(usersRes.users);
      setCompanies(companiesRes.companies);
      setEvents(auditRes.events);
    } catch (err: any) {
      setError(err.message || 'تعذر تحميل بيانات لوحة التحكم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleToggleActive = async (target: AdminUser) => {
    try {
      await api.admin.updateUser(target.id, { isActive: !target.isActive });
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث حالة المستخدم');
    }
  };

  const handleDeleteUser = async (target: AdminUser) => {
    if (!window.confirm(`هل أنت متأكد من حذف المستخدم "${target.username}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      await api.admin.deleteUser(target.id);
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل حذف المستخدم');
    }
  };

  const handleDeleteCompany = async (company: AdminCompany) => {
    if (!window.confirm(`هل أنت متأكد من حذف شركة "${company.name}"؟`)) return;
    try {
      await api.admin.deleteCompany(company.id);
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل حذف الشركة');
    }
  };

  return (
    <div className="min-h-screen bg-white text-right" dir="rtl">
      <div className="bg-gradient-to-l from-gray-900 via-gray-800 to-gray-800 text-white shadow-lg sticky top-0 z-40 border-b border-gold-700/40">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="bg-white p-2 sm:p-2.5 rounded-xl shadow-sm"><img src="/assets/logo-icon.png" alt="UM Track" className="h-6 w-auto sm:h-7" /></div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold">UM Track</h1>
              <p className="text-gold-200 text-[10px] sm:text-xs">لوحة تحكم المسؤول</p>
            </div>
          </div>
          <button
            onClick={() => api.auth.logout()}
            className="flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-xl transition-all"
            style={{ minHeight: '44px' }}
          >
            <LogOut size={16} /> خروج
          </button>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold border border-red-100 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="إغلاق"><X size={16} /></button>
          </div>
        )}

        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 font-bold uppercase">المستخدمون</p>
              <p className="text-2xl font-bold text-gray-900">{overview.totalUsers}</p>
            </div>
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 font-bold uppercase">نشطون</p>
              <p className="text-2xl font-bold text-gray-900">{overview.activeUsers}</p>
            </div>
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 font-bold uppercase">الشركات</p>
              <p className="text-2xl font-bold text-gray-900">{overview.totalCompanies}</p>
            </div>
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 font-bold uppercase">رحلات مسجلة</p>
              <p className="text-2xl font-bold text-gray-900">{overview.totalRows}</p>
            </div>
          </div>
        )}

        <div className="flex bg-gray-50 border border-gray-100 p-1 rounded-xl w-fit">
          <button onClick={() => setTab('users')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${tab === 'users' ? 'bg-gold-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><Users size={16} /> المستخدمون</button>
          <button onClick={() => setTab('companies')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${tab === 'companies' ? 'bg-gold-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><Building2 size={16} /> الشركات</button>
          <button onClick={() => setTab('activity')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${tab === 'activity' ? 'bg-gold-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><Activity size={16} /> النشاط</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gold-600" size={32} /></div>
        ) : tab === 'users' ? (
          <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-4 sm:p-6 flex justify-between items-center border-b border-gray-100">
              <h2 className="text-lg font-bold">المستخدمون</h2>
              <button onClick={() => setShowCreateUser(true)} className="flex items-center gap-2 bg-gold-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all">
                <Plus size={16} /> إضافة مستخدم
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 font-bold">
                  <tr className="border-b">
                    <th className="text-right p-3">اسم المستخدم</th>
                    <th className="text-right p-3">الشركة</th>
                    <th className="text-right p-3">الحالة</th>
                    <th className="text-right p-3">آخر دخول</th>
                    <th className="text-right p-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-bold">{u.username}{u.role === 'admin' && <span className="mr-2 text-[10px] bg-gold-100 text-gold-700 px-2 py-0.5 rounded-full">مسؤول</span>}</td>
                      <td className="p-3 text-gray-500">{u.companyName || '—'}</td>
                      <td className="p-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                          {u.isActive ? 'نشط' : 'معطل'}
                        </span>
                      </td>
                      <td className="p-3 text-gray-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجل دخول بعد'}</td>
                      <td className="p-3">
                        {u.role !== 'admin' && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => setResetPasswordUserId(u.id)} title="إعادة تعيين كلمة المرور" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><KeyRound size={16} /></button>
                            <button onClick={() => handleToggleActive(u)} title={u.isActive ? 'تعطيل' : 'تفعيل'} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                              {u.isActive ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                            </button>
                            <button onClick={() => handleDeleteUser(u)} title="حذف" className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : tab === 'companies' ? (
          <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-4 sm:p-6 flex justify-between items-center border-b border-gray-100">
              <h2 className="text-lg font-bold">الشركات</h2>
              <button onClick={() => setShowCreateCompany(true)} className="flex items-center gap-2 bg-gold-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all">
                <Plus size={16} /> إضافة شركة
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 font-bold">
                  <tr className="border-b">
                    <th className="text-right p-3">الاسم</th>
                    <th className="text-right p-3">عدد المستخدمين</th>
                    <th className="text-right p-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-bold">{c.name}</td>
                      <td className="p-3 text-gray-500">{c.userCount}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setRenameCompanyId(c.id)} title="إعادة تسمية" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><Building2 size={16} /></button>
                          <button onClick={() => handleDeleteCompany(c)} title="حذف" className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold">آخر 200 حدث</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {events.length === 0 ? (
                <p className="p-6 text-gray-400 text-sm">لا يوجد نشاط بعد</p>
              ) : events.map((e) => (
                <div key={e.id} className="p-4 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-bold">{EVENT_LABELS[e.eventType] || e.eventType}</p>
                    <p className="text-gray-400 text-xs">
                      {e.actorUsername ? `بواسطة ${e.actorUsername}` : ''}
                      {e.targetUsername ? ` — المستهدف: ${e.targetUsername}` : ''}
                    </p>
                  </div>
                  <span className="text-gray-400 text-xs">{new Date(e.createdAt).toLocaleString('ar-SA')}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {showCreateUser && (
        <CreateUserModal
          companies={companies}
          onClose={() => setShowCreateUser(false)}
          onCreated={() => { setShowCreateUser(false); loadAll(); }}
        />
      )}
      {showCreateCompany && (
        <CreateCompanyModal
          onClose={() => setShowCreateCompany(false)}
          onCreated={() => { setShowCreateCompany(false); loadAll(); }}
        />
      )}
      {resetPasswordUserId !== null && (
        <ResetPasswordModal
          userId={resetPasswordUserId}
          onClose={() => setResetPasswordUserId(null)}
          onDone={() => { setResetPasswordUserId(null); loadAll(); }}
        />
      )}
      {renameCompanyId !== null && (
        <RenameCompanyModal
          company={companies.find((c) => c.id === renameCompanyId)!}
          onClose={() => setRenameCompanyId(null)}
          onDone={() => { setRenameCompanyId(null); loadAll(); }}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 4: Wire AdminDashboard into App.tsx**

In `App.tsx`, add the import right after the existing `Auth` import:

```tsx
import { Auth } from './components/Auth';
```

becomes:

```tsx
import { Auth } from './components/Auth';
import { AdminDashboard } from './components/AdminDashboard';
```

Then update the mount-time effect — replace:

```tsx
  // Initial Load
  useEffect(() => {
    const token = localStorage.getItem('umrah_auth_token');
    if (token && typeof token === 'string' && token.split('.').length === 3) {
      // We assume the token is valid for now, or the first API call will fail and trigger logout
      const savedUser = localStorage.getItem('umrah_user');
      setUser(savedUser ? { ...JSON.parse(savedUser), token } : { token });
      loadUserData();
    } else {
      if (token) localStorage.removeItem('umrah_auth_token');
      setLoading(false);
    }
  }, []);
```

with:

```tsx
  // Initial Load
  useEffect(() => {
    const token = localStorage.getItem('umrah_auth_token');
    if (token && typeof token === 'string' && token.split('.').length === 3) {
      // We assume the token is valid for now, or the first API call will fail and trigger logout
      const savedUser = localStorage.getItem('umrah_user');
      const parsedUser = savedUser ? { ...JSON.parse(savedUser), token } : { token };
      setUser(parsedUser);
      if (parsedUser.role === 'admin') {
        setLoading(false);
      } else {
        loadUserData();
      }
    } else {
      if (token) localStorage.removeItem('umrah_auth_token');
      setLoading(false);
    }
  }, []);
```

Then update the post-login branch — replace:

```tsx
  if (!user) {
    return <Auth onLogin={(u: any) => { setUser(u); loadUserData(); }} />;
  }
```

with:

```tsx
  if (!user) {
    return <Auth onLogin={(u: any) => { setUser(u); if (u.role === 'admin') { setLoading(false); } else { loadUserData(); } }} />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard user={user} />;
  }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`

In the browser: log in with the `ADMIN_USERNAME`/`ADMIN_PASSWORD` credentials set in your local `.env.local`. Confirm:
- You land on the admin dashboard, not the operational table view.
- The overview counts render.
- Creating a user, resetting their password, disabling/enabling them, and deleting them all work and reflect immediately in the table.
- Creating, renaming, and deleting a company works, and deleting a company with an assigned user shows an error instead of silently failing.
- The Activity tab shows your own login and the actions you just took.
- Logging out and back in as a regular (non-admin) user still lands on the normal operational view, unaffected.

- [ ] **Step 7: Run the full test suite one more time and commit**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, `TypeScript: No errors found`

```bash
git add types.ts services/api.ts App.tsx components/AdminDashboard.tsx
git commit -m "feat: add the admin dashboard UI (users, companies, activity)"
```
