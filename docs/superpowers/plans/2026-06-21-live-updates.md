# Live Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebSocket invalidation so shared trip edits, imports, deletes, restores, and invitations show up without page refresh.

**Architecture:** The server keeps authenticated WebSocket connections grouped by user id. Mutating endpoints broadcast lightweight invalidation events such as `rows_changed` and `invitations_changed` to all affected users; the React client listens and calls `loadUserData()` through a small debounce.

**Tech Stack:** Express, Node HTTP upgrade, `ws`, JWT, React hooks, Vitest/Supertest for backend behavior.

## Global Constraints

- WebSocket events are invalidation-only; clients refetch data through existing APIs.
- Events must be sent to every affected user, including owners and accepted shared collaborators.
- Share invitation creation must notify the receiver immediately.
- Share invitation accept/decline must notify sender and receiver.
- Trip edit/import/delete/restore must notify users who can see the affected rows.
- Existing REST behavior must continue to pass server tests.

---

### Task 1: Server Live Hub

**Files:**
- Modify: `package.json`
- Modify: `server.ts`
- Modify: `tests/server.test.ts`

**Interfaces:**
- Produces: `attachLiveUpdates(server)` for HTTP upgrade handling.
- Produces: `broadcastLiveEvent(userIds, event)`.
- Produces: `collectVisibleUserIdsForRow(rowId, includeDeleted)`.

- [ ] Write a failing server test that share invitation creation returns a live recipient hint.
- [ ] Run targeted test and verify it fails.
- [ ] Add `ws` direct dependency and implement live hub helpers.
- [ ] Notify receiver on invitation creation.
- [ ] Run targeted test and verify it passes.

### Task 2: Broadcast Mutations

**Files:**
- Modify: `server.ts`
- Modify: `tests/server.test.ts`

**Interfaces:**
- Consumes: live hub helpers from Task 1.
- Produces: live broadcasts from sync, patch, delete, restore, invite accept, invite decline, and ingest.

- [ ] Write failing tests for live recipient hints on shared edit and group future row sync.
- [ ] Run targeted tests and verify they fail.
- [ ] Broadcast `rows_changed` to affected row/group users.
- [ ] Broadcast `invitations_changed` on accept/decline.
- [ ] Run server tests and verify they pass.

### Task 3: Frontend Live Client

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: authenticated WebSocket endpoint at `/api/live?token=<JWT>`.
- Produces: automatic `loadUserData()` after `rows_changed` or `invitations_changed`.

- [ ] Add a live updates `useEffect` after login.
- [ ] Reconnect with backoff when the socket closes.
- [ ] Debounce reload events to avoid duplicate refreshes.
- [ ] Run targeted TypeScript check.
- [ ] Run production build.
