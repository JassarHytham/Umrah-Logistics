# Chrome Extension Auto-Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable "Auto Capture" mode that silently snapshots the portal's "معلومات الرحلة" (Trip Info) page, waits until the operator leaves it, then sends the data to the existing `/api/ingest/text` endpoint — with a duplicate-confirmation prompt and a green-light/notification on success.

**Architecture:** New content script (`auto-capture.js`) detects the `<app-trip-info>` page, snapshots the full text on change, and on the page's removal hands the latest snapshot to the service worker. The service worker (`background.js`, appended section) does the authenticated duplicate-check + ingest POST (network must run here to avoid page CORS/CSP), then shows a green badge + OS notification. A new popup tab (`auto.js` + markup) shows the on/off toggle and live status. Existing `content.js` and `popup.js` behavior is untouched.

**Tech Stack:** Vanilla JS, Chrome Manifest V3 (service worker, content scripts, `chrome.storage.local`, `chrome.action`, `chrome.notifications`), Node's built-in `node:test` for pure-logic unit tests. No bundler, no framework.

## Global Constraints

- **Do not modify** existing behavior in `content.js` or `popup.js`. Additions to `background.js`, `popup.html`, and `popup.css` must be **additive** (new sections / wrappers only; preserve all existing element IDs).
- **Git:** never push to `main`. Commit locally on the current `staging` branch; do not push unless explicitly asked. End every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **No server changes.** Reuse `POST /api/ingest/text` (`{ text, groupNo, groupName, count, overwrite }`) and `GET /api/check/group/:groupNo` (`{ exists, count }`).
- **Extension source of truth:** the unpacked folder `chrome extention/umrah-extension/`. The shipped artifact `chrome extention/umrah-extension.zip` is rebuilt from it in the final task.
- **Hosts:** content scripts match `*://*.nusuk.sa/*` and `*://*.haj.gov.sa/*`.
- **Toggle default = OFF.** Auto-send is opt-in.
- **No group selected → capture nothing, send nothing.**

### Shared storage-key contract (used across tasks)

| Key | Written by | Shape |
|-----|-----------|-------|
| `umrah_auto_enabled` | popup `auto.js` | `boolean` |
| `umrah_autofill` | existing `content.js` | `{ groupNo, groupName, count, timestamp, source }` |
| `umrah_active_group` | `background.js` | `{ groupNo, groupName, count }` |
| `umrah_auto_status` | `auto-capture.js` + `background.js` | `{ state, extra, at }` |
| `umrah_auto_result` | `background.js` | `{ groupNo, groupName, rows, at }` |
| `umrah_auto_lastsent` | `background.js` | `string` (hash) |
| `umrah_server_url`, `umrah_token` | existing `popup.js` | `string` |

### Message contract (content ↔ background)

- `{ type: 'UMRAH_AUTO_FINALIZE', text, hash }` → response `{ result: 'no-group' | 'login-required' | 'sent' | 'duplicate' | 'error', count?, groupName?, rows?, message? }`
- `{ type: 'UMRAH_AUTO_SEND_OVERWRITE', text, hash }` → response `{ result: 'sent' | 'login-required' | 'no-group' | 'error', rows?, message? }`

---

### Task 1: Put the extension source under version control (reviewable baseline)

The repo currently tracks only `umrah-extension.zip`. Unpack it into a tracked source folder so every later diff is reviewable, and add a folder-local `package.json` so Node treats the test files as CommonJS regardless of the repo root's module type.

**Files:**
- Create (extract): `chrome extention/umrah-extension/` (all current files from the zip)
- Create: `chrome extention/umrah-extension/package.json`

- [ ] **Step 1: Extract the current zip into a tracked source folder**

Run:
```bash
cd "chrome extention" && unzip -o umrah-extension.zip -d . && ls umrah-extension
```
Expected: lists `manifest.json popup.html popup.js popup.css content.js background.js README.md SERVER_ENDPOINT.ts icons`.

- [ ] **Step 2: Add a folder-local package.json (scopes Node to CommonJS for tests)**

Create `chrome extention/umrah-extension/package.json`:
```json
{
  "private": true,
  "type": "commonjs"
}
```

- [ ] **Step 3: Commit the baseline (unchanged source)**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension"
git commit -m "chore: track Chrome extension source for reviewable diffs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure logic module + Node unit tests (`auto-logic.js`)

Pure, DOM-free helpers shared by the content script and the tests: text normalization (mirrors `popup.js` so auto-captured text parses identically), a stable hash for change-detection, and a snapshot-validity gate.

**Files:**
- Create: `chrome extention/umrah-extension/auto-logic.js`
- Test: `chrome extention/umrah-extension/test/auto-logic.test.js`

**Interfaces:**
- Produces (global `window.UmrahAutoLogic` in the browser; `module.exports` in Node):
  - `normalizeText(raw: string): string`
  - `fnv1aHash(str: string): string` (8 lowercase hex chars)
  - `isValidSnapshot(text: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `chrome extention/umrah-extension/test/auto-logic.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeText, fnv1aHash, isValidSnapshot } = require('../auto-logic.js');

test('normalizeText collapses space runs, converts CRLF, and trims ends', () => {
  // Note: single spaces adjacent to a newline are preserved by design
  // (this mirrors popup.js exactly so parsing stays identical).
  assert.strictEqual(normalizeText('  a   b \r\n c  '), 'a b \n c');
});

test('normalizeText breaks "تاريخ ...: value" onto a new line', () => {
  assert.strictEqual(normalizeText('تاريخ الوصول: 2026-07-08'), 'تاريخ الوصول\n2026-07-08');
});

test('normalizeText tolerates null/undefined', () => {
  assert.strictEqual(normalizeText(null), '');
  assert.strictEqual(normalizeText(undefined), '');
});

test('fnv1aHash is 8 hex chars and stable', () => {
  const h = fnv1aHash('hello');
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.strictEqual(h, fnv1aHash('hello'));
});

test('fnv1aHash differs for different input', () => {
  assert.notStrictEqual(fnv1aHash('a'), fnv1aHash('b'));
});

test('isValidSnapshot true when long and has both arrival+departure markers', () => {
  const text = 'رحلة الوصول '.repeat(6) + 'رحلة المغادرة '.repeat(6);
  assert.strictEqual(isValidSnapshot(text), true);
});

test('isValidSnapshot false when too short', () => {
  assert.strictEqual(isValidSnapshot('الوصول المغادرة'), false);
});

test('isValidSnapshot false when a marker is missing', () => {
  assert.strictEqual(isValidSnapshot('رحلة الوصول '.repeat(20)), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd "chrome extention/umrah-extension" && node --test
```
Expected: FAIL — `Cannot find module '../auto-logic.js'`.

- [ ] **Step 3: Implement `auto-logic.js`**

Create `chrome extention/umrah-extension/auto-logic.js`:
```js
// ══════════════════════════════════════════════════════
//  auto-logic.js — pure, framework-free helpers shared by
//  the content script (auto-capture.js) and Node unit tests.
//  No DOM, no chrome.* — keep it pure for testability.
// ══════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UmrahAutoLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Mirror of popup.js normalizeText so auto-captured text parses identically.
  function normalizeText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
      .replace(/(تاريخ[^:\n\r]{0,30}):\s*/g, '$1\n')
      .replace(/(وقت[^:\n\r]{0,20}):\s*/g, '$1\n')
      .replace(/(المطار[^:\n\r]{0,20}):\s*/g, '$1\n')
      .replace(/(رقم الرحلة[^:\n\r]{0,10}):\s*/g, '$1\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // FNV-1a 32-bit → stable 8-char hex. Detects snapshot changes and
  // lets us skip re-sending identical data.
  function fnv1aHash(str) {
    let h = 0x811c9dc5;
    const s = String(str == null ? '' : str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // A snapshot is worth sending only if it looks like a fully-rendered
  // trip page: enough text AND both arrival + departure markers present.
  function isValidSnapshot(text) {
    const t = String(text == null ? '' : text);
    if (t.trim().length < 80) return false;
    return t.indexOf('الوصول') !== -1 && t.indexOf('المغادرة') !== -1;
  }

  return { normalizeText, fnv1aHash, isValidSnapshot };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd "chrome extention/umrah-extension" && node --test
```
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension/auto-logic.js" "chrome extention/umrah-extension/test/auto-logic.test.js"
git commit -m "feat(ext): add pure auto-capture logic helpers with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Register the new scripts in `manifest.json`

Additive manifest changes: extend `content.js` to `haj.gov.sa`, add the `auto-logic.js` + `auto-capture.js` content script on both hosts, add the `notifications` permission, bump the version.

**Files:**
- Modify: `chrome extention/umrah-extension/manifest.json`

- [ ] **Step 1: Replace the manifest with the additive version**

Overwrite `chrome extention/umrah-extension/manifest.json` with:
```json
{
  "manifest_version": 3,
  "name": "Umrah Logistics Capture",
  "version": "1.2.0",
  "description": "Capture itinerary text from any page → send directly to Umrah Logistics Pro",
  "permissions": [
    "activeTab",
    "storage",
    "scripting",
    "clipboardRead",
    "notifications"
  ],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://*.nusuk.sa/*", "*://*.haj.gov.sa/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://*.nusuk.sa/*", "*://*.haj.gov.sa/*"],
      "js": ["auto-logic.js", "auto-capture.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

> Note: `auto-capture.js` does not exist yet (Task 4). Chrome tolerates a missing file with a load warning; the end-to-end load verification happens in Task 8. This step is committable on its own because the manifest is valid JSON and the other entries load.

- [ ] **Step 2: Validate the manifest is well-formed JSON**

Run:
```bash
cd "chrome extention/umrah-extension" && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"
```
Expected: `manifest OK`.

- [ ] **Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension/manifest.json"
git commit -m "feat(ext): register auto-capture content script and notifications permission

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Content script — detect, snapshot, finalize, confirm (`auto-capture.js`)

Detects `<app-trip-info>`, snapshots the page text on change (debounced), and on the element's removal sends the latest snapshot to the background; renders the in-page duplicate-confirm modal when the background reports a duplicate.

**Files:**
- Create: `chrome extention/umrah-extension/auto-capture.js`

**Interfaces:**
- Consumes: `window.UmrahAutoLogic.{normalizeText, fnv1aHash, isValidSnapshot}` (Task 2); the message contract + storage keys from Global Constraints.
- Produces: sends `UMRAH_AUTO_FINALIZE` / `UMRAH_AUTO_SEND_OVERWRITE`; writes `umrah_auto_status`.

- [ ] **Step 1: Implement `auto-capture.js`**

Create `chrome extention/umrah-extension/auto-capture.js`:
```js
// ══════════════════════════════════════════════════════
//  auto-capture.js  (NEW, additive)
//  Auto-detects the "معلومات الرحلة" (Trip Info) wizard step,
//  snapshots the page while the operator edits, and on leaving
//  the page hands the latest snapshot to the background to send.
//  Existing content.js (group-row capture) is untouched.
// ══════════════════════════════════════════════════════
(function () {
  if (window.__umrahAutoInjected) return;
  window.__umrahAutoInjected = true;

  const L = window.UmrahAutoLogic;            // auto-logic.js (loaded first)
  const ENABLED_KEY  = 'umrah_auto_enabled';
  const STATUS_KEY   = 'umrah_auto_status';
  const LASTSENT_KEY = 'umrah_auto_lastsent';

  let enabled  = false;
  let onPage   = false;
  let snapshot = null;     // { text, hash }
  let debounce = null;

  function setStatus(state, extra) {
    chrome.storage.local.set({ [STATUS_KEY]: { state, extra: extra || '', at: Date.now() } });
  }

  function tripRoot() { return document.querySelector('app-trip-info'); }

  // ── DOM text extraction (TreeWalker; no clipboard) ──────
  function extractText(root) {
    const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TD','TH','TR','BLOCKQUOTE','SECTION','ARTICLE','ASIDE','MAIN','BR','FIGURE','FIGCAPTION','DT','DD','LABEL']);
    const SKIP  = new Set(['SCRIPT','STYLE','NOSCRIPT','HEAD','BUTTON','NAV','FOOTER','HEADER']);
    const SKIP_INPUT = new Set(['hidden','submit','button','reset','image','file','checkbox','radio']);
    function shouldSkip(el) {
      if (SKIP.has(el.tagName)) return true;
      const c = (el.className || '').toString().toLowerCase(), id = (el.id || '').toLowerCase();
      return /\b(nav|navbar|footer|header|sidebar|menu|ads?|cookie|banner|modal)\b/.test(c + ' ' + id);
    }
    let out = '';
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) { return n.nodeType === Node.ELEMENT_NODE && shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.nodeValue.trim()) out += n.nodeValue;
      } else {
        if (BLOCK.has(n.tagName) && out.length && !out.endsWith('\n')) out += '\n';
        if (n.tagName === 'INPUT') {
          const t = (n.type || 'text').toLowerCase();
          if (!SKIP_INPUT.has(t) && n.value && n.value.trim()) { if (!out.endsWith('\n')) out += '\n'; out += n.value.trim() + '\n'; }
        } else if (n.tagName === 'SELECT') {
          const s = n.options && n.options[n.selectedIndex];
          if (s && s.text.trim()) { if (!out.endsWith('\n')) out += '\n'; out += s.text.trim() + '\n'; }
        } else if (n.tagName === 'TEXTAREA' && n.value && n.value.trim()) {
          if (!out.endsWith('\n')) out += '\n'; out += n.value.trim() + '\n';
        }
      }
    }
    return L.normalizeText(out);
  }

  function takeSnapshot() {
    const root = tripRoot();
    if (!root) return;
    const text = extractText(root);
    if (!L.isValidSnapshot(text)) return;
    snapshot = { text, hash: L.fnv1aHash(text) };
    setStatus('monitoring', 'captured');
  }

  function scheduleSnapshot() {
    clearTimeout(debounce);
    debounce = setTimeout(takeSnapshot, 1000);
  }

  // ── In-page duplicate-confirm modal ─────────────────────
  function showDupModal(count, groupName) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.id = 'umrah-dup-modal';
      wrap.setAttribute('dir', 'rtl');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:Tahoma,Arial,sans-serif;';
      wrap.innerHTML =
        '<div style="background:#fff;max-width:360px;width:90%;border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center;">' +
          '<div style="font-size:32px">⚠️</div>' +
          '<div style="font-weight:700;margin:8px 0;color:#b45309">المجموعة موجودة مسبقاً</div>' +
          '<div style="font-size:14px;color:#444;margin-bottom:16px">يوجد ' + count + ' رحلة محفوظة للمجموعة "' + (groupName || '') + '". هل تريد الاستبدال أم الإيقاف؟</div>' +
          '<div style="display:flex;gap:10px;justify-content:center">' +
            '<button id="umrah-dup-overwrite" style="flex:1;padding:10px;border:0;border-radius:8px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer">🔄 استبدال</button>' +
            '<button id="umrah-dup-stop" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-weight:700;cursor:pointer">إيقاف</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      function close(decision) { wrap.remove(); resolve(decision); }
      wrap.querySelector('#umrah-dup-overwrite').addEventListener('click', () => close('overwrite'));
      wrap.querySelector('#umrah-dup-stop').addEventListener('click', () => close('stop'));
    });
  }

  // ── Finalize: send latest snapshot when leaving the page ─
  async function finalize() {
    if (!enabled || !snapshot) return;
    const snap = snapshot;
    snapshot = null;                                  // consume; avoid double-send
    const store = await chrome.storage.local.get([LASTSENT_KEY]);
    if (store[LASTSENT_KEY] === snap.hash) return;    // unchanged → skip

    setStatus('finalizing');
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'UMRAH_AUTO_FINALIZE', text: snap.text, hash: snap.hash });
    } catch (_) { setStatus('error', 'background unavailable'); return; }
    if (!res) { setStatus('error', 'no response'); return; }

    if (res.result === 'duplicate') {
      const decision = await showDupModal(res.count, res.groupName);
      if (decision === 'stop') { setStatus('stopped'); return; }
      try {
        const ov = await chrome.runtime.sendMessage({ type: 'UMRAH_AUTO_SEND_OVERWRITE', text: snap.text, hash: snap.hash });
        if (ov && ov.result === 'sent') setStatus('sent', String(ov.rows || 0));
        else setStatus(ov && ov.result === 'login-required' ? 'login-required' : 'error', ov && ov.message);
      } catch (_) { setStatus('error', 'overwrite failed'); }
      return;
    }
    // sent | no-group | login-required | error are also persisted by background;
    // mirror the terminal state locally for immediacy.
    if (res.result === 'sent') setStatus('sent', String(res.rows || 0));
    else setStatus(res.result, res.message);
  }

  // ── Page presence tracking ──────────────────────────────
  function evaluatePresence() {
    const present = !!tripRoot();
    if (present && !onPage) { onPage = true; setStatus('monitoring'); takeSnapshot(); }
    else if (!present && onPage) { onPage = false; finalize(); }
  }

  const mo = new MutationObserver(() => {
    if (!enabled) return;
    evaluatePresence();
    if (onPage) scheduleSnapshot();
  });

  function start() { mo.observe(document.body, { childList: true, subtree: true }); evaluatePresence(); }
  function stop()  { mo.disconnect(); onPage = false; snapshot = null; setStatus('disabled'); }

  // ── React to the on/off toggle ──────────────────────────
  function applyEnabled(val) {
    enabled = !!val;
    if (enabled) { setStatus('waiting'); start(); }
    else { stop(); }
  }

  chrome.storage.local.get([ENABLED_KEY], (r) => applyEnabled(r[ENABLED_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ENABLED_KEY]) applyEnabled(changes[ENABLED_KEY].newValue);
  });
})();
```

> **Hard-unload note:** there is intentionally no `pagehide` send. Per spec, if the operator hard-closes the tab while still on the trip page, the send is skipped (no silent overwrite). SPA Next/Back/route changes remove `<app-trip-info>` and are caught by the MutationObserver.

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
cd "chrome extention/umrah-extension" && node --check auto-capture.js && echo "syntax OK"
```
Expected: `syntax OK`.

- [ ] **Step 3: Re-run the logic tests (ensure Task 2 still green)**

Run:
```bash
cd "chrome extention/umrah-extension" && node --test
```
Expected: PASS — 8 tests.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension/auto-capture.js"
git commit -m "feat(ext): add auto-capture content script (detect, snapshot, finalize, dup modal)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Service worker — group mirror, dup-check, ingest, badge, notification (`background.js`)

Append a self-contained section to `background.js`. The existing context-menu code stays at the top, unchanged.

**Files:**
- Modify (append only): `chrome extention/umrah-extension/background.js`

**Interfaces:**
- Consumes: message contract + storage keys (Global Constraints); server endpoints `GET /api/check/group/:groupNo`, `POST /api/ingest/text`.
- Produces: writes `umrah_active_group`, `umrah_auto_status`, `umrah_auto_result`, `umrah_auto_lastsent`; sets badge + notification.

- [ ] **Step 1: Append the auto-capture section to `background.js`**

Append to the end of `chrome extention/umrah-extension/background.js`:
```js

// ══════════════════════════════════════════════════════
//  AUTO-CAPTURE SUPPORT (appended; existing code above unchanged)
//  • Mirrors the selected group so it survives the wizard steps.
//  • Performs the authenticated duplicate-check + ingest POST.
//    Network runs HERE (not in the content script) to avoid the
//    page's CORS/CSP restrictions.
//  • Shows the green badge + notification on success.
// ══════════════════════════════════════════════════════
(function () {
  const URL_KEY      = 'umrah_server_url';
  const TOKEN_KEY    = 'umrah_token';
  const AUTOFILL_KEY = 'umrah_autofill';
  const GROUP_KEY    = 'umrah_active_group';
  const STATUS_KEY   = 'umrah_auto_status';
  const RESULT_KEY   = 'umrah_auto_result';
  const LASTSENT_KEY = 'umrah_auto_lastsent';

  function get(keys) { return chrome.storage.local.get(keys); }
  function set(obj)  { return chrome.storage.local.set(obj); }
  function setStatus(state, extra) { set({ [STATUS_KEY]: { state, extra: extra || '', at: Date.now() } }); }

  // Mirror group-row capture (umrah_autofill) → persistent active group.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const af = changes[AUTOFILL_KEY];
    if (af && af.newValue && af.newValue.groupNo && af.newValue.groupName) {
      set({ [GROUP_KEY]: {
        groupNo: af.newValue.groupNo,
        groupName: af.newValue.groupName,
        count: af.newValue.count || ''
      }});
    }
  });

  function badge(text, color) {
    try {
      chrome.action.setBadgeText({ text: text || '' });
      if (color) chrome.action.setBadgeBackgroundColor({ color });
    } catch (_) {}
  }
  function notify(title, message) {
    try {
      chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message });
    } catch (_) {}
  }

  async function apiBase() {
    const s = await get([URL_KEY, TOKEN_KEY]);
    return { url: (s[URL_KEY] || '').replace(/\/$/, ''), token: s[TOKEN_KEY] || '' };
  }

  async function checkDuplicate(base, groupNo) {
    const res = await fetch(`${base.url}/api/check/group/${encodeURIComponent(groupNo)}`, {
      headers: { 'Authorization': `Bearer ${base.token}` }
    });
    if (res.status === 401) return { auth: false };
    if (!res.ok) return { auth: true, exists: false, count: 0 };
    const data = await res.json().catch(() => ({}));
    return { auth: true, exists: !!data.exists, count: data.count || 0 };
  }

  async function ingest(base, group, text, overwrite) {
    const res = await fetch(`${base.url}/api/ingest/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${base.token}` },
      body: JSON.stringify({
        text, groupNo: group.groupNo, groupName: group.groupName,
        count: group.count, overwrite: !!overwrite
      })
    });
    if (res.status === 401) return { auth: false };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { auth: true, ok: false, message: data.error || ('HTTP ' + res.status) };
    return { auth: true, ok: true, rows: (data.rows || []).length };
  }

  async function doSend(group, text, hash, overwrite) {
    const base = await apiBase();
    if (!base.token) { setStatus('login-required'); badge('!', '#dc2626'); return { result: 'login-required' }; }
    const r = await ingest(base, group, text, overwrite);
    if (!r.auth) { setStatus('login-required'); badge('!', '#dc2626'); return { result: 'login-required' }; }
    if (!r.ok)   { setStatus('error', r.message); badge('!', '#dc2626'); return { result: 'error', message: r.message }; }
    await set({
      [LASTSENT_KEY]: hash,
      [RESULT_KEY]: { groupNo: group.groupNo, groupName: group.groupName, rows: r.rows, at: Date.now() }
    });
    setStatus('sent', String(r.rows));
    badge('✓', '#16a34a');
    notify('تم الإرسال', `تم إرسال ${r.rows} رحلة للمجموعة "${group.groupName}"`);
    setTimeout(() => badge('', '#16a34a'), 6000);
    return { result: 'sent', rows: r.rows };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'UMRAH_AUTO_FINALIZE') {
      (async () => {
        const s = await get([GROUP_KEY]);
        const group = s[GROUP_KEY];
        if (!group || !group.groupNo || !group.groupName) { setStatus('no-group'); sendResponse({ result: 'no-group' }); return; }
        const base = await apiBase();
        if (!base.token) { setStatus('login-required'); badge('!', '#dc2626'); sendResponse({ result: 'login-required' }); return; }
        setStatus('sending');
        const dup = await checkDuplicate(base, group.groupNo).catch(() => ({ auth: true, exists: false, count: 0 }));
        if (dup.auth === false) { setStatus('login-required'); badge('!', '#dc2626'); sendResponse({ result: 'login-required' }); return; }
        if (dup.exists) { sendResponse({ result: 'duplicate', count: dup.count, groupName: group.groupName }); return; }
        sendResponse(await doSend(group, msg.text, msg.hash, false));
      })();
      return true;   // keep sendResponse alive (async)
    }

    if (msg.type === 'UMRAH_AUTO_SEND_OVERWRITE') {
      (async () => {
        const s = await get([GROUP_KEY]);
        const group = s[GROUP_KEY];
        if (!group || !group.groupNo) { sendResponse({ result: 'no-group' }); return; }
        sendResponse(await doSend(group, msg.text, msg.hash, true));
      })();
      return true;   // async
    }
  });
})();
```

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
cd "chrome extention/umrah-extension" && node --check background.js && echo "syntax OK"
```
Expected: `syntax OK`.

- [ ] **Step 3: Confirm existing context-menu code is still present (not modified)**

Run:
```bash
cd "chrome extention/umrah-extension" && grep -c "umrah-capture-selection" background.js
```
Expected: `2` (the two existing references remain).

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension/background.js"
git commit -m "feat(ext): background auto-send with dup-check, badge and notification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Popup markup — tabs + auto panel (`popup.html`, `popup.css`)

Add a two-tab bar, wrap the existing manual views in `#manualPane` (IDs preserved), add `#autoPane`, and load `auto.js`. Append styles.

**Files:**
- Modify: `chrome extention/umrah-extension/popup.html`
- Modify (append): `chrome extention/umrah-extension/popup.css`

- [ ] **Step 1: Insert the tab bar + open `#manualPane` before the login view**

In `chrome extention/umrah-extension/popup.html`, replace:
```html
  <!-- LOGIN VIEW -->
```
with:
```html
  <div class="tabbar">
    <button id="tabManual" class="tab active">يدوي</button>
    <button id="tabAuto" class="tab">تلقائي</button>
  </div>

  <div id="manualPane">

  <!-- LOGIN VIEW -->
```

- [ ] **Step 2: Close `#manualPane` and add `#autoPane` + `auto.js` before the popup script**

In `chrome extention/umrah-extension/popup.html`, replace:
```html
  <script src="popup.js"></script>
```
with:
```html
  </div><!-- /manualPane -->

  <div id="autoPane" class="hidden">
    <div class="auto-row">
      <div>
        <div class="auto-title">الالتقاط التلقائي</div>
        <div class="auto-sub">يلتقط صفحة "معلومات الرحلة" تلقائياً ويُرسلها عند مغادرتك للصفحة</div>
      </div>
      <label class="switch">
        <input id="autoToggle" type="checkbox" />
        <span class="slider"></span>
      </label>
    </div>

    <div class="auto-status">
      <span id="autoDot" class="auto-dot"></span>
      <span id="autoStatusText">—</span>
    </div>

    <div class="auto-meta">
      <div><span class="auto-meta-label">المجموعة الحالية:</span> <span id="autoGroup">—</span></div>
      <div><span class="auto-meta-label">آخر إرسال:</span> <span id="autoLastSync">—</span></div>
      <div><span class="auto-meta-label">عدد الرحلات المُرسلة:</span> <span id="autoRows">—</span></div>
    </div>
  </div>

  <script src="popup.js"></script>
  <script src="auto.js"></script>
```

- [ ] **Step 3: Append styles to `popup.css`**

Append to the end of `chrome extention/umrah-extension/popup.css`:
```css

/* ── Auto Capture tab additions ───────────────────────── */
.tabbar { display: flex; gap: 6px; padding: 8px 12px 0; }
.tab { flex: 1; padding: 8px; border: 0; border-radius: 8px 8px 0 0; background: #eef0f3; color: #555; font-weight: 700; cursor: pointer; font-family: inherit; }
.tab.active { background: #fff; color: #111; box-shadow: 0 -2px 0 #16a34a inset; }
#autoPane { padding: 14px; }
.auto-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.auto-title { font-weight: 700; }
.auto-sub { font-size: 12px; color: #666; margin-top: 2px; }
.auto-status { display: flex; align-items: center; gap: 8px; margin: 14px 0; font-weight: 600; }
.auto-dot { width: 10px; height: 10px; border-radius: 50%; background: #9ca3af; }
.auto-dot.green { background: #16a34a; }
.auto-dot.amber { background: #f59e0b; }
.auto-dot.red { background: #dc2626; }
.auto-dot.blue { background: #2563eb; }
.auto-meta { font-size: 13px; color: #444; display: flex; flex-direction: column; gap: 4px; }
.auto-meta-label { color: #888; }
.switch { position: relative; display: inline-block; width: 46px; height: 26px; }
.switch input { display: none; }
.slider { position: absolute; cursor: pointer; inset: 0; background: #ccc; border-radius: 26px; transition: .2s; }
.slider:before { content: ''; position: absolute; height: 20px; width: 20px; right: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: .2s; }
.switch input:checked + .slider { background: #16a34a; }
.switch input:checked + .slider:before { transform: translateX(-20px); }
```

- [ ] **Step 4: Verify the existing manual IDs are intact**

Run:
```bash
cd "chrome extention/umrah-extension" && grep -c -e 'id="loginView"' -e 'id="captureView"' -e 'id="manualPane"' -e 'id="autoPane"' popup.html
```
Expected: `4` (all four IDs present).

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension/popup.html" "chrome extention/umrah-extension/popup.css"
git commit -m "feat(ext): add manual/auto tabs and auto-capture panel to popup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Popup logic — tab switching + live status (`auto.js`)

Owns only the auto tab: persists the toggle, switches panes, and renders live status from storage. Does not touch `popup.js`.

**Files:**
- Create: `chrome extention/umrah-extension/auto.js`

**Interfaces:**
- Consumes: storage keys `umrah_auto_enabled`, `umrah_auto_status`, `umrah_auto_result`, `umrah_active_group`; DOM IDs from Task 6.

- [ ] **Step 1: Implement `auto.js`**

Create `chrome extention/umrah-extension/auto.js`:
```js
// ══════════════════════════════════════════════════════
//  auto.js  (NEW popup script)
//  Owns the "تلقائي" tab: tab switching, on/off toggle, live status.
//  Does NOT touch the manual view logic in popup.js.
// ══════════════════════════════════════════════════════
(function () {
  const ENABLED_KEY = 'umrah_auto_enabled';
  const STATUS_KEY  = 'umrah_auto_status';
  const RESULT_KEY  = 'umrah_auto_result';
  const GROUP_KEY   = 'umrah_active_group';

  const tabManual  = document.getElementById('tabManual');
  const tabAuto    = document.getElementById('tabAuto');
  const manualPane = document.getElementById('manualPane');
  const autoPane   = document.getElementById('autoPane');
  const toggle     = document.getElementById('autoToggle');
  const dot        = document.getElementById('autoDot');
  const statusText = document.getElementById('autoStatusText');
  const groupEl    = document.getElementById('autoGroup');
  const lastSync   = document.getElementById('autoLastSync');
  const rowsEl     = document.getElementById('autoRows');

  const STATUS_MAP = {
    disabled:         { dot: '',     text: 'غير مفعّل' },
    waiting:          { dot: 'blue', text: 'بانتظار صفحة الرحلة' },
    monitoring:       { dot: 'green',text: '🟢 جارٍ المراقبة — الصفحة مفتوحة' },
    finalizing:       { dot: 'blue', text: 'جارٍ المعالجة…' },
    sending:          { dot: 'blue', text: '📤 جارٍ الإرسال…' },
    sent:             { dot: 'green',text: '✅ تم الإرسال' },
    'no-group':       { dot: 'amber',text: '⚠️ لا توجد مجموعة محددة' },
    stopped:          { dot: 'amber',text: 'أُوقف بواسطة المستخدم' },
    'login-required': { dot: 'red',  text: '⚠️ سجّل الدخول من تبويب "يدوي"' },
    error:            { dot: 'red',  text: '❌ خطأ في الإرسال' }
  };

  function showTab(which) {
    const auto = which === 'auto';
    autoPane.classList.toggle('hidden', !auto);
    manualPane.classList.toggle('hidden', auto);
    tabAuto.classList.toggle('active', auto);
    tabManual.classList.toggle('active', !auto);
  }
  tabManual.addEventListener('click', () => showTab('manual'));
  tabAuto.addEventListener('click',   () => showTab('auto'));

  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ [ENABLED_KEY]: toggle.checked });
  });

  function fmtTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('ar'); } catch (_) { return '—'; }
  }
  function renderStatus(st) {
    const key = st && st.state ? st.state : 'disabled';
    const m = STATUS_MAP[key] || STATUS_MAP.disabled;
    dot.className = 'auto-dot' + (m.dot ? ' ' + m.dot : '');
    statusText.textContent = m.text + (st && st.extra ? ` (${st.extra})` : '');
  }
  function renderResult(r) {
    if (!r) { lastSync.textContent = '—'; rowsEl.textContent = '—'; return; }
    lastSync.textContent = fmtTime(r.at);
    rowsEl.textContent = (r.rows != null ? r.rows : '—');
  }
  function renderGroup(g) {
    groupEl.textContent = g && g.groupName ? `${g.groupName} (${g.groupNo})` : '—';
  }

  async function refresh() {
    const s = await chrome.storage.local.get([ENABLED_KEY, STATUS_KEY, RESULT_KEY, GROUP_KEY]);
    toggle.checked = !!s[ENABLED_KEY];
    renderStatus(s[ENABLED_KEY] ? s[STATUS_KEY] : { state: 'disabled' });
    renderResult(s[RESULT_KEY]);
    renderGroup(s[GROUP_KEY]);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STATUS_KEY]) renderStatus(toggle.checked ? changes[STATUS_KEY].newValue : { state: 'disabled' });
    if (changes[RESULT_KEY]) renderResult(changes[RESULT_KEY].newValue);
    if (changes[GROUP_KEY])  renderGroup(changes[GROUP_KEY].newValue);
    if (changes[ENABLED_KEY]) refresh();
  });

  refresh();
})();
```

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
cd "chrome extention/umrah-extension" && node --check auto.js && echo "syntax OK"
```
Expected: `syntax OK`.

- [ ] **Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension/auto.js"
git commit -m "feat(ext): add auto-capture popup tab logic and live status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Rebuild the distributable zip + full manual verification

Rebuild `umrah-extension.zip` from the source folder (excluding dev-only files), load it in Chrome, and verify the end-to-end flow against a running server.

**Files:**
- Modify (regenerate): `chrome extention/umrah-extension.zip`

- [ ] **Step 1: Rebuild the zip (exclude test/ and the dev package.json)**

Run:
```bash
cd "chrome extention" && rm -f umrah-extension.zip && \
zip -r umrah-extension.zip umrah-extension \
  -x 'umrah-extension/test/*' 'umrah-extension/package.json' && \
unzip -l umrah-extension.zip
```
Expected: archive lists `auto-logic.js`, `auto-capture.js`, `auto.js`, updated `manifest.json`, `popup.html/css/js`, `background.js`, `content.js`, `icons/` — and does **not** list `test/` or `package.json`.

- [ ] **Step 2: Load unpacked and confirm no errors**

Manual:
1. Open `chrome://extensions`, enable Developer mode.
2. "Load unpacked" → select `chrome extention/umrah-extension`.
3. Confirm the card shows **no red "Errors"** and version reads **1.2.0**.
4. Click "service worker" → DevTools console has no exceptions on load.

Expected: extension loads cleanly; both content-script entries and the service worker register.

- [ ] **Step 3: Verify toggle persistence + tab UI**

Manual:
1. Click the extension icon → popup shows two tabs: **يدوي** / **تلقائي**.
2. **يدوي** still shows the original login/capture UI unchanged.
3. **تلقائي** shows the toggle (OFF) and status "غير مفعّل".
4. Turn the toggle ON, close and reopen the popup → toggle stays ON, status "بانتظار صفحة الرحلة".

Expected: tab switching works; toggle persists across popup reopen.

- [ ] **Step 4: Verify group mirroring**

Manual (server running, logged in via the يدوي tab):
1. On the portal group-list page, open a group's cog menu (existing capture).
2. In `chrome://extensions` → service worker DevTools console, run:
   `chrome.storage.local.get('umrah_active_group', console.log)`.

Expected: logs `{ umrah_active_group: { groupNo, groupName, count } }` for the clicked group.

- [ ] **Step 5: Verify the happy path (new group, no duplicate)**

Manual:
1. With auto ON and a non-duplicate group selected, navigate into the wizard to the **معلومات الرحلة** step.
2. Popup **تلقائي** status → "🟢 جارٍ المراقبة".
3. Click **التالي** (or **عودة**) to leave the step.
4. Observe: extension badge turns green **✓**, an OS notification "تم الإرسال …" appears, popup status → "✅ تم الإرسال", and the rows count + last-sync update.
5. Open the web app → the new rows are present for that group.

Expected: data sent once; badge + notification + popup all reflect success.

- [ ] **Step 6: Verify the duplicate path**

Manual:
1. Re-enter the same group's **معلومات الرحلة** step, change a value (so the hash differs), then leave the step.
2. An in-page modal appears: "المجموعة موجودة مسبقاً … استبدال / إيقاف".
3. Click **إيقاف** → nothing sent, popup status "أُوقف بواسطة المستخدم".
4. Repeat and click **🔄 استبدال** → rows for that group are replaced (not duplicated); badge green + notification.

Expected: stop aborts cleanly; overwrite replaces the group's rows.

- [ ] **Step 7: Verify the no-group and unchanged guards**

Manual:
1. Clear the group: service-worker console → `chrome.storage.local.remove('umrah_active_group')`. Enter+leave the trip step → popup status "⚠️ لا توجد مجموعة محددة"; nothing sent.
2. Re-select a group, send once, then re-enter+leave the step **without** changing anything → no second send (hash unchanged).

Expected: both guards hold.

- [ ] **Step 8: Commit the rebuilt zip**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "chrome extention/umrah-extension.zip"
git commit -m "build(ext): rebuild distributable zip with auto-capture mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verification Items (carried from the spec)

These require the live portal/server and are covered by Task 8's manual steps; flag any that fail for follow-up:

1. Group-list DOM (`td[id="groupNumber"]`, `pi-cog`) is identical on `haj.gov.sa` (Task 8 Step 4). If group capture does not fire there, `content.js` needs host-specific selectors — **out of scope for this plan; raise as follow-up.**
2. `<app-trip-info>` is the stable page marker (Task 8 Step 5).
3. `parseItineraryText` produces correct rows from the TreeWalker text (Task 8 Step 5 — inspect rows in the web app: arrival, both hotels, both enrichment services, departure).
4. Background `fetch` works under MV3 with the stored token (Task 8 Steps 5–6).

## Out of Scope

- Structured-JSON extraction / new server endpoint.
- Changes to manual capture, login, or the popup's existing duplicate UI.
- Wizard steps other than Trip Info.
- Host-specific group-list selectors if `haj.gov.sa` differs (follow-up).
