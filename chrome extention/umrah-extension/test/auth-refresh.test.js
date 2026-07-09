const test = globalThis.test || require('node:test').test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

test('popup persists and automatically uses refresh tokens', () => {
  assert.match(popup, /umrah_refresh_token/);
  assert.match(popup, /\/api\/auth\/refresh/);
  assert.match(popup, /res\.status === 401 && await refreshAccessToken/);
});

test('background auto-capture refreshes expired access tokens', () => {
  assert.match(background, /umrah_refresh_token/);
  assert.match(background, /\/api\/auth\/refresh/);
  assert.match(background, /fetchWithAuth/);
});
