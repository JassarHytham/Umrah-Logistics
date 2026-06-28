# Chrome Extension Self-Hosting and Update Flow (Design Spec)

**Date:** 2026-06-28
**Status:** Approved
**Scope:** Replace the current ZIP-only Chrome extension distribution flow with self-hosted CRX packaging, environment-specific update manifests, and an in-extension manual update trigger.

---

## 1. Problem and Goal

The current browser-extension distribution flow is manual: operators download `umrah-extension.zip`, unzip it, enable Chrome developer mode, and load the folder as an unpacked extension. Updates require repeating the same process. This is operationally expensive and easy to get wrong across staging and production.

The goal is to support:
- self-hosted signed `.crx` artifacts for staging and production;
- self-hosted `updates.xml` manifests so installed extensions can auto-update;
- a manual "Check for Update" action in the popup;
- separate staging and production extension identities so both can coexist in one browser;
- deployment automation that packages and publishes the right extension variant on the existing VPS.

---

## 2. Platform Constraint

Chrome's documented self-hosted extension install flow outside the Chrome Web Store is limited. The repository should still implement signed `.crx` packaging and update manifests, but the UI must not claim that one-click installation works universally on all Chrome platforms. The install surface should present the `.crx` download as the preferred path while retaining clear fallback guidance for manual unpacked install where Chrome blocks direct CRX installation.

This constraint affects copy and documentation only. The packaging and update mechanism remains valid and useful.

---

## 3. Current Findings

- The extension source lives in `chrome extention/umrah-extension/`.
- The web app currently serves `GET /api/download/extension` from the static ZIP at `chrome extention/umrah-extension.zip`.
- The settings page in `components/Settings.tsx` links to that ZIP and explains unpacked installation.
- The extension popup already has a second "auto" tab and is safe to extend with an update-control section.
- Deployment happens on the VPS over SSH in `.github/workflows/deploy.yml`, with separate `main` and `staging` branches already mapped to separate application directories.
- No extension build or packaging pipeline exists yet.

---

## 4. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Package the extension on the VPS after each deploy, not on GitHub Actions runners | Keeps private signing keys off GitHub and fits the existing server-side deploy model. |
| 2 | Store signing keys outside git under environment-specific VPS paths | Prevents key leakage and keeps staging/prod IDs independent. |
| 3 | Introduce `manifest.base.json`, `manifest.staging.json`, and `manifest.prod.json` | Makes environment-specific name and `update_url` explicit while preserving one shared manifest shape. |
| 4 | Generate `manifest.json`, `.crx`, and `updates.xml` as build artifacts | Keeps source clean and deployment deterministic. |
| 5 | Publish artifacts under `/extensions/staging/` and `/extensions/prod/` | Matches the user's routing requirement and keeps environments isolated. |
| 6 | Keep the existing ZIP endpoint, but demote it to a fallback/manual-install path | Avoids breaking current users and handles Chrome platform limitations. |
| 7 | Add a popup "Check for Update" button that uses `chrome.runtime.requestUpdateCheck()` | Lets operators pull updates immediately without waiting for Chrome's poll interval. |

---

## 5. Architecture

The new flow has four cooperating parts:

1. **Extension source and manifest templating**
   - Shared extension code stays in `chrome extention/umrah-extension/`.
   - Source control stores `manifest.base.json` plus environment overlays for staging and production.
   - A packaging script materializes the final `manifest.json` for the target environment before zipping/signing.

2. **Packaging and publishing**
   - A repository script assembles a clean extension bundle, signs it with a provided PEM, emits a `.crx`, and writes a matching `updates.xml`.
   - The deploy workflow calls that script after the app build on the VPS.
   - Output is copied into `/var/www/umrah-<env>/public/extensions/<env>/` so Express can serve it directly.

3. **App download/install surface**
   - The web app exposes environment-aware extension asset URLs and metadata through the server.
   - Settings UI shows the CRX install button, version label, and fallback/manual-install notes.
   - Existing ZIP download remains available as a fallback link.

4. **Runtime updates**
   - Installed extensions read their environment-specific `update_url`.
   - Chrome polls `updates.xml` automatically.
   - The popup's manual update control runs `chrome.runtime.requestUpdateCheck()`, shows status, and reloads the extension when Chrome reports an available update.

---

## 6. File Responsibilities

- `chrome extention/umrah-extension/manifest.base.json`
  Shared MV3 manifest fields common to both environments.

- `chrome extention/umrah-extension/manifest.staging.json`
  Staging-only fields such as extension name and staging `update_url`.

- `chrome extention/umrah-extension/manifest.prod.json`
  Production-only fields such as extension name and production `update_url`.

- `chrome extention/umrah-extension/popup.html`
  Adds a manual update button and status area.

- `chrome extention/umrah-extension/popup.js`
  Implements `requestUpdateCheck()` handling and renders update status.

- `scripts/package-extension.mjs`
  Builds the target manifest, creates a ZIP, signs the extension, emits `.crx`, and writes `updates.xml`.

- `server.ts`
  Serves extension artifacts and metadata from environment-specific public directories.

- `components/Settings.tsx`
  Replaces ZIP-first copy with CRX-first install/update messaging while retaining fallback instructions.

- `.github/workflows/deploy.yml`
  Calls the packaging script for `main` and `staging`, passing environment-specific output directories and PEM paths.

- `tests/deployWorkflow.test.ts`
  Verifies the workflow contains the new packaging/publication steps.

- `tests/server.test.ts`
  Verifies extension metadata and download endpoints resolve the right environment-specific files.

- `chrome extention/umrah-extension/test/manual-update.test.js`
  Verifies popup files contain the manual update control and update-check API call.

---

## 7. Data and Paths

Expected artifact layout on each deployed app host:

- Production:
  - app route path: `/extensions/prod/umrah-extension.crx`
  - update manifest path: `/extensions/prod/updates.xml`
  - filesystem directory: `/var/www/umrah-prod/public/extensions/prod/`
  - signing key path: `/var/lib/umrah/prod/keys/umrah-extension.pem`

- Staging:
  - app route path: `/extensions/staging/umrah-extension.crx`
  - update manifest path: `/extensions/staging/updates.xml`
  - filesystem directory: `/var/www/umrah-staging/public/extensions/staging/`
  - signing key path: `/var/lib/umrah/staging/keys/umrah-extension.pem`

The exact PEM paths are configurable through environment variables in the deploy script so operators can keep their current VPS layout if needed.

---

## 8. Update Behavior

- `manifest.prod.json` points `update_url` at the production `updates.xml`.
- `manifest.staging.json` points `update_url` at the staging `updates.xml`.
- Each environment uses a different PEM, producing a different extension ID.
- The popup button shows one of:
  - checking;
  - update available, reloading;
  - no update found;
  - throttled;
  - failed / unsupported.

If Chrome reports `update_available`, the popup should call `chrome.runtime.reload()` after a short success message so the new version activates immediately.

---

## 9. Error Handling

- Missing packaging key on deploy should fail the deploy job clearly before publishing stale artifacts.
- Missing generated artifacts at runtime should surface as `404` from the server and as a degraded install section in the settings page, not as an app crash.
- The popup update button should fail gracefully if `chrome.runtime.requestUpdateCheck` is unavailable or returns an error.
- ZIP fallback remains available even if CRX artifacts are absent.

---

## 10. Testing Strategy

- Static extension popup regression test for the manual update control.
- Workflow regression test for packaging and publication commands on both branches.
- Server/API test for extension metadata/download endpoint selection by environment.
- `npm run lint` for app and server typing.
- Existing extension `node --test` suite to ensure no regression in popup/manual flows.

---

## 11. Out of Scope

- Publishing to the Chrome Web Store.
- Managing PEM generation inside the repository.
- Editing the VPS Nginx configuration automatically from the app deploy. The repository should provide the exact MIME-type and location requirements in docs or deployment comments, but the existing server admin still applies them on the VPS.
