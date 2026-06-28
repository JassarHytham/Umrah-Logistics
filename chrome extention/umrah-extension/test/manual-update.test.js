const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

test('popup exposes a manual check-for-update control', () => {
  assert.match(popupHtml, /checkUpdateBtn/);
  assert.match(popupHtml, /تحديث/);
  assert.match(popupJs, /chrome\.runtime\.requestUpdateCheck/);
  assert.match(popupJs, /chrome\.runtime\.reload/);
});
