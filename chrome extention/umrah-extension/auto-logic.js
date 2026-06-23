// ══════════════════════════════════════════════════════
//  auto-logic.js — pure, framework-free helpers shared by
//  the content script (auto-capture.js) and Node unit tests.
//  No DOM, no chrome.* — keep it pure for testability.
// ══════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UmrahAutoLogic = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Mirror of popup.js normalizeText so auto-captured text parses identically.
  function normalizeText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
      .replace(/(تاريخ[^:\n\r]{0,30}):\s*/g, '$1\n')
      .replace(/(وقت[^:\n\r]{0,20}):\s*/g, '$1\n')
      .replace(/(المطار[^:\n\r]{0,20}):\s*/g, '$1\n')
      .replace(/(رقم الرحلة[^:\n\r]{0,10}):\s*/g, '$1\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // FNV-1a 32-bit → stable 8-char hex. Detects snapshot changes and
  // lets us skip re-sending identical data.
  function fnv1aHash(str) {
    let h = 0x811c9dc5;
    const s = String(str == null ? '' : str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // A snapshot is worth sending only if it looks like a fully-rendered
  // trip page: enough text, both full section headers present, AND at least
  // one date — which confirms Angular's data binding has loaded real data,
  // not just the empty skeleton template that appears before the HTTP response.
  function isValidSnapshot(text) {
    const t = String(text == null ? '' : text);
    if (t.trim().length < 80) return false;
    if (t.indexOf('رحلة الوصول') === -1 || t.indexOf('رحلة المغادرة') === -1) return false;
    return /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2}/.test(t);
  }

  return { normalizeText, fnv1aHash, isValidSnapshot };
});
