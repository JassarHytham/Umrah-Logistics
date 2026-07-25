const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifestProd = JSON.parse(fs.readFileSync(path.join(root, 'manifest.prod.json'), 'utf8'));
const manifestStaging = JSON.parse(fs.readFileSync(path.join(root, 'manifest.staging.json'), 'utf8'));

test('prod manifest pins the fixed server URL, staging does not', () => {
  assert.strictEqual(manifestProd.umrah_fixed_server_url, 'http://157.173.122.139:3000');
  assert.strictEqual(manifestStaging.umrah_fixed_server_url, undefined);
});

test('popup hides the server URL field and forces the fixed URL when present', () => {
  assert.match(popupHtml, /id="serverUrlField"/);
  assert.match(popupJs, /umrah_fixed_server_url/);
  assert.match(popupJs, /serverUrlField\.classList\.add\('hidden'\)/);
  assert.match(popupJs, /FIXED_SERVER_URL \|\| serverUrlInput\.value/);
});

test('background auto-capture also targets the fixed URL when present', () => {
  assert.match(background, /umrah_fixed_server_url/);
  assert.match(background, /FIXED_SERVER_URL \|\| \(s\[URL_KEY\] \|\| ''\)/);
});
