# Extension Self-Hosting and Update Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-hosted CRX packaging, environment-specific update manifests, deployment automation, and a manual extension update trigger while keeping ZIP fallback install support.

**Architecture:** Build the extension from one shared source tree with environment overlays for manifest fields, then package and sign it on the VPS during deploy so private keys never leave the server. Serve generated artifacts from environment-specific public directories and expose them through the app UI and extension popup.

**Tech Stack:** Chrome Extension MV3, Node.js packaging script, Express, React 19, GitHub Actions SSH deploy, Node built-in extension tests, Vitest.

## Global Constraints

- Do not publish the extension to the Chrome Web Store.
- Keep staging and production on separate extension IDs by using separate PEM keys.
- Preserve the current ZIP fallback path for manual unpacked installs.
- Do not commit private keys or generated CRX artifacts to git.
- Keep the install UI honest about Chrome platform limitations outside the Web Store.

---

### Task 1: Manifest Overlay and Popup Update Control

**Files:**
- Create: `chrome extention/umrah-extension/manifest.base.json`
- Create: `chrome extention/umrah-extension/manifest.staging.json`
- Create: `chrome extention/umrah-extension/manifest.prod.json`
- Modify: `chrome extention/umrah-extension/manifest.json`
- Modify: `chrome extention/umrah-extension/popup.html`
- Modify: `chrome extention/umrah-extension/popup.js`
- Test: `chrome extention/umrah-extension/test/manual-update.test.js`

**Interfaces:**
- Consumes: existing MV3 extension source tree and popup layout.
- Produces: environment-specific manifest inputs and popup update behavior based on `chrome.runtime.requestUpdateCheck()`.

- [ ] Write the failing extension regression test.
- [ ] Run `node --test "chrome extention/umrah-extension/test/manual-update.test.js"` and verify it fails.
- [ ] Add manifest overlay files and the popup update control with minimal logic.
- [ ] Re-run `node --test "chrome extention/umrah-extension/test/manual-update.test.js"` and verify it passes.

### Task 2: Packaging Script and Public Artifact Layout

**Files:**
- Create: `scripts/package-extension.mjs`
- Modify: `.gitignore`
- Test: `tests/deployWorkflow.test.ts`

**Interfaces:**
- Consumes: manifest overlay files, extension source directory, PEM path, target environment, public output directory.
- Produces: generated `manifest.json`, ZIP, `.crx`, and `updates.xml` in a target output directory.

- [ ] Write the failing workflow regression expectations for extension packaging and publication.
- [ ] Run `npm test -- tests/deployWorkflow.test.ts` and verify the new assertions fail.
- [ ] Implement the packaging script and ignore generated extension artifacts.
- [ ] Re-run `npm test -- tests/deployWorkflow.test.ts` after wiring workflow changes in Task 4 and verify it passes.

### Task 3: Server Metadata and App Install Surface

**Files:**
- Modify: `server.ts`
- Modify: `components/Settings.tsx`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: runtime environment (`production` or `staging`) and generated public extension artifacts.
- Produces: environment-aware extension metadata plus CRX/ZIP download links shown in the settings page.

- [ ] Write failing server tests for environment-aware extension metadata.
- [ ] Run the targeted server test and verify it fails.
- [ ] Implement server metadata/download behavior and update the settings UI.
- [ ] Re-run the targeted server test and verify it passes.

### Task 4: Deploy Workflow Integration

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Test: `tests/deployWorkflow.test.ts`

**Interfaces:**
- Consumes: package script from Task 2 and branch-specific deploy directories.
- Produces: packaged extension artifacts in `/public/extensions/prod` and `/public/extensions/staging` during deploy.

- [ ] Update the workflow to call the packaging script with environment-specific PEM and output paths.
- [ ] Ensure production and staging publish to distinct directories and use distinct PEM variables.
- [ ] Re-run `npm test -- tests/deployWorkflow.test.ts` and verify all expectations pass.

### Task 5: End-to-End Verification

**Files:**
- No additional file changes.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: verified self-hosted extension packaging and update flow.

- [ ] Run `node --test "chrome extention/umrah-extension/test"/*.test.js`.
- [ ] Run `npm test -- tests/deployWorkflow.test.ts tests/server.test.ts`.
- [ ] Run `npm run lint`.
- [ ] Review generated diff to confirm no private keys or binary artifacts were added.
