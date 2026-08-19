// ══════════════════════════════════════════════════════
//  Umrah Logistics Capture — config.js
//
//  Single source of truth for the server this extension talks to.
//
//  There used to be two builds of this extension — a prod one that baked the
//  server URL into a custom `umrah_fixed_server_url` manifest key and hid the
//  URL field, and a staging one that left the field editable. That meant two
//  manifests, two signing keys, two CRX bundles and two update feeds to keep in
//  step. There is now one build: everyone gets DEFAULT_SERVER_URL, and anyone
//  who genuinely needs to point somewhere else turns on developer mode in the
//  popup's settings panel, which stores an override in chrome.storage.local.
// ══════════════════════════════════════════════════════

// Shared by popup.js (via <script src>) and background.js (via importScripts).
const UMRAH_DEFAULT_SERVER_URL = 'http://157.173.122.139:3000';

// Set when the user enables developer mode and saves a custom URL. Absent for
// every ordinary install, which then falls back to the default above.
const UMRAH_STORAGE_KEY_URL = 'umrah_server_url';
const UMRAH_STORAGE_KEY_DEV_MODE = 'umrah_dev_mode';

// Service workers get these via importScripts; the popup gets them as globals.
if (typeof globalThis !== 'undefined') {
  globalThis.UMRAH_DEFAULT_SERVER_URL = UMRAH_DEFAULT_SERVER_URL;
  globalThis.UMRAH_STORAGE_KEY_URL = UMRAH_STORAGE_KEY_URL;
  globalThis.UMRAH_STORAGE_KEY_DEV_MODE = UMRAH_STORAGE_KEY_DEV_MODE;
}
