const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifestBase = JSON.parse(fs.readFileSync(path.join(root, 'manifest.base.json'), 'utf8'));

test('manifest requests the alarms permission', () => {
  assert.ok(manifestBase.permissions.includes('alarms'));
});

test('background registers a periodic proactive token-refresh alarm', () => {
  assert.match(background, /chrome\.alarms\.create\(/);
  assert.match(background, /periodInMinutes/);
  assert.match(background, /chrome\.runtime\.onInstalled\.addListener\(scheduleProactiveRefresh\)/);
  assert.match(background, /chrome\.runtime\.onStartup\.addListener\(scheduleProactiveRefresh\)/);
});

test('the alarm handler refreshes the access token without requiring a 401 first', () => {
  assert.match(background, /chrome\.alarms\.onAlarm\.addListener\(/);
  assert.match(background, /if \(base\.refreshToken\) await refreshAccessToken\(base\);/);
});
