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

test('background ingest treats an HTTP 200 duplicate-skipped response with no rows as success', () => {
  const ingest = background.match(/async function ingest\(base, group, text, overwrite\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(ingest);
  assert.match(ingest, /if \(!res\.ok\) return \{ auth: true, ok: false,/);
  assert.match(ingest, /return \{ auth: true, ok: true, rows: \(data\.rows \|\| \[\]\)\.length \};/);
});
