# Chrome Extension — Auto Capture Mode (Design Spec)

**Date:** 2026-06-17
**Status:** Approved (pending written-spec review)
**Scope:** Add an automatic trip-info capture mode to the existing `umrah-extension` Chrome extension, without modifying existing capture behavior.

---

## 1. Problem & Goal

The current extension captures itinerary data **manually**: the operator opens the popup, clicks "capture page text", fills the group fields, and sends to the server. On the Saudi e-portal's **"معلومات الرحلة" (Trip Info)** wizard step — an Angular SPA page containing arrival flight, hotels, enrichment services, departure flight, and a trip timeline — this is tedious and error-prone.

**Goal:** A hands-off mode that:
- Detects when the operator is on the Trip Info page.
- Silently keeps the latest snapshot of the page's data **while the operator is still editing** (does not send mid-edit).
- Sends to the server **only when the operator leaves the page** (Next / Back / route change / exit).
- Associates the data with the group the operator selected earlier (reusing the existing row-click capture).
- Shows live "it's working" status in a new extension tab, and a **green light + small notification** on success.
- Can be toggled on/off.
- Asks before overwriting an existing group (duplicate confirmation).

**Non-goals:** No changes to the existing manual capture flow, no server-side changes, no new parser.

---

## 2. Key Findings (from current code + page HTML)

- Existing extension files: `manifest.json`, `content.js` (group-row capture on `nusuk.sa`), `popup.html/css/js` (manual flow), `background.js` (context menu only).
- `content.js` already captures `groupNo / groupName / count` into `chrome.storage.local.umrah_autofill` when a group row's cog menu is opened.
- `popup.js` sends to `POST /api/ingest/text` with `{ text, groupNo, groupName, count, overwrite }`; the server runs `parseItineraryText` (no structured endpoint needed).
- A duplicate-check endpoint already exists: `GET /api/check/group/:groupNo` → `{ exists, count }`.
- Storage keys in use: `umrah_server_url`, `umrah_token`, `umrah_last_group`, `umrah_autofill`.
- The Trip Info page is identifiable by a single `<app-trip-info>` element; all relevant data lives inside it. Leave-buttons are `التالي` (Next) and `عودة` (Back). The portal is served from `haj.gov.sa` (orchestrator.haj.gov.sa) and `nusuk.sa`.

---

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Hosts: `*://*.nusuk.sa/*` **and** `*://*.haj.gov.sa/*` | Portal spans both domains. |
| 2 | Group identity = reuse `umrah_autofill` (row-click capture); **no group → capture & send nothing** | Per requirement; no manual entry on the trip page. |
| 3 | Data path = extract full page text → existing `/api/ingest/text` parser | Operator preference ("copy the whole page and parse as now"); zero server changes. |
| 4 | Toggle default = **OFF** | Auto-send is opt-in. |
| 5 | Duplicate handling = **check, then in-page confirm modal** (Overwrite / Stop) | Replaces blanket overwrite; operator stays in control. |
| 6 | Add `notifications` permission | For the "small notification when done." Green badge works without it. |
| 7 | Text extraction = DOM TreeWalker (not clipboard `execCommand`) | Automatic mode must not hijack the operator's clipboard. |

---

## 4. Architecture

Existing `content.js` / `popup.js` are **not modified**. New behavior is additive.

```
┌─────────────────────────────── haj.gov.sa / nusuk.sa page (SPA) ──────────────────────────────┐
│                                                                                                │
│  content.js (existing)            auto-capture.js (NEW)                                         │
│  group-row click ──► umrah_autofill   │                                                        │
│                                       │ • detect <app-trip-info> present  → status "monitoring"│
│                                       │ • on DOM change (debounced) → snapshot full text+hash  │
│                                       │ • on <app-trip-info> removed / pagehide → FINALIZE      │
│                                       │ • render in-page duplicate-confirm modal when asked     │
└───────────────────────────────────────┼────────────────────────────────────────────────────────┘
                                         │ chrome.runtime messages
                                         ▼
                           background.js (existing + APPENDED section)
                           • mirror umrah_autofill → umrah_active_group (persistent)
                           • on FINALIZE: gate on group → GET /api/check/group/:groupNo
                                 - exists → ask content script to show modal
                                 - not exists → POST /api/ingest/text (add)
                           • on OVERWRITE confirm → POST /api/ingest/text (overwrite=true)
                           • success → green badge "✓" + notification + store umrah_auto_status/result
                           • 401 → red badge + status "login required"
                                         ▲
                                         │ chrome.storage (live state)
                           popup: auto.js + new "تلقائي" tab in popup.html
                           • on/off toggle, live status, active group, last sync, rows sent
```

---

## 5. Components

### 5.1 `auto-capture.js` (new content script)
- **Guard:** run only when enabled (`umrah_auto_enabled === true`); re-check on storage change.
- **Page detection:** locate `<app-trip-info>`; maintain `onPage` state via a `MutationObserver` on `document.body` (childList/subtree) plus initial check. Writes `umrah_auto_status` = `monitoring` when present.
- **Snapshot:** when on page and the subtree mutates, debounce ~1s, then extract full text via a TreeWalker port of the existing `extractPageText`/`normalizeText` (scoped to `<app-trip-info>`, fallback to `document.body`). Store latest `{ text, hash }` in memory; mirror a short status to storage for the popup ("captured, pending send").
- **Validity check before finalize:** text length over a threshold and contains expected markers (e.g. `الوصول` / `المغادرة`) — guards against sending a half-rendered page.
- **Finalize triggers:** `<app-trip-info>` removed from DOM (SPA Next/Back/route change) — primary; `pagehide` — best-effort backup.
- **Finalize action:** if enabled + snapshot valid + `hash !== lastSentHash` → `chrome.runtime.sendMessage({ type: 'UMRAH_AUTO_FINALIZE', text, hash })`.
- **Duplicate modal:** on `{ type: 'UMRAH_AUTO_CONFIRM_DUP', count, groupName }` from background, inject a small fixed-position RTL modal with two buttons → reply `overwrite` or `stop`. Self-removes after choice. Only feasible while the SPA document is alive (Next/Back path); on hard unload no prompt is shown and the send is skipped.

### 5.2 `background.js` (appended section — existing code untouched)
- **Group mirror:** `chrome.storage.onChanged` for `umrah_autofill` → copy to persistent `umrah_active_group`. Survives the multi-step wizard (the 60s freshness window in popup.js does not apply here).
- **Message handler `UMRAH_AUTO_FINALIZE`:**
  1. Read `umrah_active_group`. If missing → status `no-group`, abort (nothing sent).
  2. Read `umrah_server_url` + `umrah_token`. If token missing → status `login-required`, red badge, abort.
  3. `GET /api/check/group/:groupNo`.
     - `exists === true` → send `UMRAH_AUTO_CONFIRM_DUP` to the tab; await reply.
       - `overwrite` → POST ingest with `overwrite: true`.
       - `stop` → status `stopped`, abort.
     - else → POST ingest with `overwrite: false`.
  4. On success → set `lastSentHash`, green badge "✓", `chrome.notifications` "تم إرسال رحلة المجموعة …", store `umrah_auto_result` (group, rows, time).
  5. On 401 → red badge, status `login-required`. On other error → status `error` + message.
- **Badge helper:** green ✓ on success (auto-clears after ~6s), red on auth/error.

### 5.3 `popup.html` / `popup.css` (additive)
- A 2-tab bar at the top: **يدوي** (existing manual view, unchanged) / **تلقائي** (new). Existing element IDs and markup preserved.
- New auto panel: on/off toggle (switch), live status line with colored dot, active group display, last sync time, rows-sent count, and a short last-result line.

### 5.4 `auto.js` (new popup script, loaded alongside `popup.js`)
- Owns tab switching and the auto panel only (does not touch manual-view logic).
- Reads/writes `umrah_auto_enabled`; renders live state from `umrah_auto_status` / `umrah_auto_result` / `umrah_active_group`; subscribes to `chrome.storage.onChanged` for live updates.

### 5.5 `manifest.json` (additive only)
- New content script entry: `auto-capture.js`, matches `*://*.nusuk.sa/*` + `*://*.haj.gov.sa/*`, `run_at: document_idle`.
- Extend existing `content.js` match list to also include `*://*.haj.gov.sa/*` (group capture on the new host; **assumes the group-list DOM is the same across both hosts** — flagged as a verification item).
- Add `"notifications"` to `permissions`.
- Bump `version`.

---

## 6. Storage Keys (new)

| Key | Owner | Purpose |
|-----|-------|---------|
| `umrah_auto_enabled` | popup `auto.js` | Feature on/off (default false) |
| `umrah_active_group` | background | Persistent copy of selected group |
| `umrah_auto_status` | content + background | Live status string for popup |
| `umrah_auto_result` | background | Last send result (group, rows, time) |
| `umrah_auto_lastsent` | background | Last sent hash (dedupe) |

---

## 7. Status State Machine

`disabled` → `waiting` (enabled, not on trip page) → `monitoring` (on trip page) → `finalizing` → (`confirm-dup` ⇄ user) → `sending` → `sent` ✓ | `no-group` ⚠️ | `stopped` | `login-required` | `error`.

---

## 8. Edge Cases

- **No group selected:** abort silently with `no-group` status; nothing stored or sent.
- **Re-entering the page unchanged:** `hash === lastSentHash` → no resend.
- **Re-entering and editing:** new hash → finalize again; duplicate-confirm protects the existing group.
- **Half-rendered page:** validity threshold blocks the send.
- **Token expired (401):** red badge + `login-required`; operator logs in via the manual tab.
- **Hard tab close on trip page:** no modal possible → skip send (no silent overwrite).
- **Toggle OFF:** content script loads but performs no capture/send.

---

## 9. Verification Items (for the implementation plan)

1. Confirm the group-list DOM (`td[id="groupNumber"]`, `pi-cog`) is identical on `haj.gov.sa`; if not, group capture on that host needs its own selectors (follow-up).
2. Confirm `<app-trip-info>` is the stable, reliable page marker across portal versions.
3. Confirm `/api/ingest/text` + `parseItineraryText` produce correct rows from the TreeWalker text of this page (arrival, both hotels, both enrichment services, departure).
4. Confirm background `fetch` to the operator's server works under MV3 with the stored token.

---

## 10. Out of Scope

- Structured-JSON extraction and any new server endpoint.
- Changes to manual capture, login, or the existing duplicate UI in the popup.
- Capturing wizard steps other than Trip Info.
