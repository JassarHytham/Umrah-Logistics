/**
 * Pins the "one extension, store-ready" shape.
 *
 * There used to be two builds — a prod manifest that baked the server URL into a
 * custom `umrah_fixed_server_url` key, and a staging manifest that left the URL
 * editable — plus a signed CRX and an updates.xml feed. The Chrome Web Store
 * rejects any package carrying `update_url`, so these tests guard the properties
 * that have to hold for a submission to be accepted, and the settings-panel
 * behaviour that replaced the per-build URL handling.
 */
const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const config = read('config.js');
const popupJs = read('popup.js');
const popupHtml = read('popup.html');
const background = read('background.js');

test('ships exactly one manifest, with no channel overlays left behind', () => {
  for (const stale of ['manifest.base.json', 'manifest.prod.json', 'manifest.staging.json']) {
    assert.strictEqual(
      fs.existsSync(path.join(root, stale)),
      false,
      `${stale} should be gone — there is only one build now`,
    );
  }
});

test('manifest carries no update_url, which the Chrome Web Store rejects', () => {
  assert.strictEqual(manifest.update_url, undefined);
});

test('manifest no longer uses the custom fixed-server-url key', () => {
  assert.strictEqual(manifest.umrah_fixed_server_url, undefined);
  assert.doesNotMatch(popupJs, /umrah_fixed_server_url/);
  assert.doesNotMatch(background, /umrah_fixed_server_url/);
});

test('manifest stays on the published version', () => {
  assert.strictEqual(manifest.version, '2.0.1');
});

test('the default server URL lives in one shared place', () => {
  assert.match(config, /UMRAH_DEFAULT_SERVER_URL = 'http:\/\/157\.173\.122\.139:3000'/);
  // Both surfaces read it from config.js rather than redefining it.
  assert.match(popupJs, /const DEFAULT_SERVER_URL = UMRAH_DEFAULT_SERVER_URL/);
  assert.match(background, /const DEFAULT_SERVER_URL = UMRAH_DEFAULT_SERVER_URL/);
  assert.match(background, /importScripts\('config\.js'\)/);
  assert.match(popupHtml, /<script src="config\.js"><\/script>/);
});

test('popup ships a settings panel with version, server URL, dev toggle and logout', () => {
  for (const id of [
    'settingsBtn', 'settingsPanel', 'settingsVersion', 'settingsServer',
    'devModeToggle', 'devServerUrl', 'settingsLogoutBtn',
  ]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`), `popup.html should expose #${id}`);
  }
  assert.match(popupJs, /settingsVersion\.textContent = `v\$\{chrome\.runtime\.getManifest\(\)\.version\}`/);
  assert.match(popupJs, /settingsServer\.textContent = serverUrl/);
});

test('the first page no longer shows the server bar, version or update controls', () => {
  for (const gone of ['serverLabel', 'manifestVersion', 'checkUpdateBtn', 'updateStatus', 'server-bar']) {
    assert.doesNotMatch(popupHtml, new RegExp(gone), `popup.html should no longer contain ${gone}`);
    assert.doesNotMatch(popupJs, new RegExp(gone), `popup.js should no longer reference ${gone}`);
  }
});

test('the manual update check is gone — the store handles updates', () => {
  assert.doesNotMatch(popupJs, /requestUpdateCheck/);
  assert.doesNotMatch(popupHtml, /فحص التحديث/);
});

test('the login form no longer asks for a server URL', () => {
  assert.doesNotMatch(popupHtml, /id="serverUrlField"/);
  assert.doesNotMatch(popupHtml, /id="serverUrl"/);
  assert.doesNotMatch(popupJs, /serverUrlInput/);
});

test('a stored URL is only honoured while developer mode is on', () => {
  // Both the popup and the background worker must agree, otherwise auto-capture
  // would keep posting to a stale override after the checkbox was turned off.
  assert.match(popupJs, /serverUrl = \(devMode && stored\[STORAGE_KEY_URL\]\) \|\| DEFAULT_SERVER_URL/);
  assert.match(background, /s\[DEV_MODE_KEY\] \? String\(s\[URL_KEY\] \|\| ''\)/);
  assert.match(background, /url: override \|\| DEFAULT_SERVER_URL/);
});

test('turning developer mode off clears the override', () => {
  assert.match(popupJs, /chrome\.storage\.local\.remove\(STORAGE_KEY_URL\)/);
});

test('the manual/automatic tab switcher starts hidden in markup', () => {
  // Must be hidden before popup.js ever runs, otherwise there is a flash where a
  // signed-out user can see (and click) the tab switcher before JS hides it.
  assert.match(popupHtml, /id="tabbar" class="tabbar hidden"/);
});

test('showLoginView hides the tab switcher and forces the manual pane', () => {
  const fn = popupJs.slice(popupJs.indexOf('function showLoginView'), popupJs.indexOf('function showCaptureView'));
  assert.match(fn, /tabbar\.classList\.add\('hidden'\)/);
  assert.match(fn, /manualPane\.classList\.remove\('hidden'\)/);
  assert.match(fn, /autoPane\.classList\.add\('hidden'\)/);
});

test('showCaptureView reveals the tab switcher only after a session exists', () => {
  const fn = popupJs.slice(popupJs.indexOf('function showCaptureView'), popupJs.indexOf('// ══', popupJs.indexOf('function showCaptureView')));
  assert.match(fn, /tabbar\.classList\.remove\('hidden'\)/);
});
