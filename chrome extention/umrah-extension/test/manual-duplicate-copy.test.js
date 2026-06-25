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
