# Extension Duplicate Add Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make duplicate group handling in the Chrome extension offer three choices: add duplicate rows, overwrite existing rows, or cancel.

**Architecture:** Keep the backend `/api/ingest/text` contract unchanged because `overwrite: false` already preserves existing rows and adds parsed rows. Update the extension UI and auto-capture message flow so the duplicate prompt exposes that existing behavior explicitly.

**Tech Stack:** Chrome extension JavaScript, DOM content script, service worker messaging, Node built-in test runner for static regression checks.

## Global Constraints

- Do not reintroduce the reverted security hardening commits.
- Preserve existing manual and auto-capture behavior for non-duplicate groups.
- Use `overwrite: false` for the new "add duplicate" path.
- Keep UI copy Arabic and concise.

---

### Task 1: Auto-Capture Duplicate Prompt

**Files:**
- Modify: `chrome extention/umrah-extension/auto-capture.js`
- Modify: `chrome extention/umrah-extension/background.js`
- Test: `chrome extention/umrah-extension/test/auto-duplicate-options.test.js`

**Interfaces:**
- Consumes: existing `UMRAH_AUTO_FINALIZE` duplicate response `{ result: 'duplicate', count, groupName }`.
- Produces: new content-script decision `add` that sends `UMRAH_AUTO_SEND_DUPLICATE`; background handles it with `doSend(group, text, hash, false)`.

- [ ] **Step 1: Write failing static regression test**

```js
const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const autoCapture = fs.readFileSync(path.join(root, 'auto-capture.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

test('auto duplicate modal offers add, overwrite, and stop choices', () => {
  assert.match(autoCapture, /id="umrah-dup-add"/);
  assert.match(autoCapture, /id="umrah-dup-overwrite"/);
  assert.match(autoCapture, /id="umrah-dup-stop"/);
  assert.match(autoCapture, /UMRAH_AUTO_SEND_DUPLICATE/);
});

test('background duplicate send path preserves existing rows', () => {
  assert.match(background, /UMRAH_AUTO_SEND_DUPLICATE/);
  assert.match(background, /doSend\(group,\s*msg\.text,\s*msg\.hash,\s*false\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "chrome extention/umrah-extension/test/auto-duplicate-options.test.js"`
Expected: FAIL because `umrah-dup-add` and `UMRAH_AUTO_SEND_DUPLICATE` do not exist yet.

- [ ] **Step 3: Implement the minimal code**

Update the modal to render three buttons. On `add`, send `UMRAH_AUTO_SEND_DUPLICATE`; on `overwrite`, keep the existing overwrite message; on `stop`, do nothing and set stopped status.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "chrome extention/umrah-extension/test/auto-duplicate-options.test.js"`
Expected: PASS.

### Task 2: Manual Popup Duplicate Wording

**Files:**
- Modify: `chrome extention/umrah-extension/popup.html`
- Modify: `chrome extention/umrah-extension/popup.js`
- Test: `chrome extention/umrah-extension/test/manual-duplicate-copy.test.js`

**Interfaces:**
- Consumes: existing manual `doSend(overwrite)` flow.
- Produces: explicit duplicate add copy on the normal send button while preserving `doSend(false)`.

- [ ] **Step 1: Write failing static regression test**

```js
const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

test('manual duplicate UI labels add duplicate and overwrite choices', () => {
  assert.match(popupJs, /إضافة كنسخة مكررة/);
  assert.match(popupHtml, /استبدال/);
  assert.match(popupJs, /doSend\(false\)/);
  assert.match(popupJs, /doSend\(true\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "chrome extention/umrah-extension/test/manual-duplicate-copy.test.js"`
Expected: FAIL because the manual copy says "إضافة فوق القديم".

- [ ] **Step 3: Implement wording update**

Change duplicate-state send text and success copy to say "إضافة كنسخة مكررة" for `overwrite: false`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "chrome extention/umrah-extension/test/manual-duplicate-copy.test.js"`
Expected: PASS.

### Task 3: Full Verification

**Files:**
- No additional file changes.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: verified extension duplicate behavior.

- [ ] **Step 1: Run extension tests**

Run: `node --test "chrome extention/umrah-extension/test"/*.test.js`
Expected: PASS.

- [ ] **Step 2: Run app typecheck**

Run: `npm run lint`
Expected: PASS.
