const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const { normalizeText, fnv1aHash, isValidSnapshot, extractGroupRowData } = require('../auto-logic.js');

test('normalizeText collapses space runs, converts CRLF, and trims ends', () => {
  // Note: single spaces adjacent to a newline are preserved by design
  // (this mirrors popup.js exactly so parsing stays identical).
  assert.strictEqual(normalizeText('  a   b \r\n c  '), 'a b \n c');
});

test('normalizeText breaks "تاريخ ...: value" onto a new line', () => {
  assert.strictEqual(normalizeText('تاريخ الوصول: 2026-07-08'), 'تاريخ الوصول\n2026-07-08');
});

test('normalizeText tolerates null/undefined', () => {
  assert.strictEqual(normalizeText(null), '');
  assert.strictEqual(normalizeText(undefined), '');
});

test('fnv1aHash is 8 hex chars and stable', () => {
  const h = fnv1aHash('hello');
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.strictEqual(h, fnv1aHash('hello'));
});

test('fnv1aHash differs for different input', () => {
  assert.notStrictEqual(fnv1aHash('a'), fnv1aHash('b'));
});

test('isValidSnapshot true when long and has both arrival+departure markers and a date', () => {
  const text = 'رحلة الوصول '.repeat(6) + 'تاريخ الوصول: 2026-07-08\n' + 'رحلة المغادرة '.repeat(6);
  assert.strictEqual(isValidSnapshot(text), true);
});

test('isValidSnapshot false when too short', () => {
  assert.strictEqual(isValidSnapshot('الوصول المغادرة'), false);
});

test('isValidSnapshot false when a marker is missing', () => {
  assert.strictEqual(isValidSnapshot('رحلة الوصول '.repeat(20)), false);
});

test('isValidSnapshot false when arrival and departure headers exist but no date has loaded', () => {
  const text = 'رحلة الوصول '.repeat(6) + 'رحلة المغادرة '.repeat(6);
  assert.strictEqual(isValidSnapshot(text), false);
});

test('extractGroupRowData captures agency from eaName cell', () => {
  const cells = {
    groupNumber: '480900139756',
    groupName: 'Amirah July Grp 1',
    mutamerNumber: '6',
    eaName: 'اميرة ترافيل',
  };
  const row = {
    querySelector(selector) {
      const match = selector.match(/td\[id="([^"]+)"\]/);
      const id = match && match[1];
      return id && cells[id] !== undefined ? { textContent: cells[id] } : null;
    },
  };
  const cellText = (td) => (td ? td.textContent.trim() : '');

  assert.deepStrictEqual(extractGroupRowData(row, cellText), {
    groupNo: '480900139756',
    groupName: 'Amirah July Grp 1',
    agency: 'اميرة ترافيل',
    count: '6',
  });
});
