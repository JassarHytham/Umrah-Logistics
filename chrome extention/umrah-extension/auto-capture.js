// ══════════════════════════════════════════════════════
//  auto-capture.js  (NEW, additive)
//  Auto-detects the "معلومات الرحلة" (Trip Info) wizard step,
//  snapshots the page while the operator edits, and on leaving
//  the page hands the latest snapshot to the background to send.
//  Existing content.js (group-row capture) is untouched.
// ══════════════════════════════════════════════════════
(function () {
  if (window.__umrahAutoInjected) return;
  window.__umrahAutoInjected = true;

  const L = window.UmrahAutoLogic;            // auto-logic.js (loaded first)
  const ENABLED_KEY  = 'umrah_auto_enabled';
  const STATUS_KEY   = 'umrah_auto_status';
  const LASTSENT_KEY = 'umrah_auto_lastsent';

  let enabled  = false;
  let onPage   = false;
  let snapshot = null;     // { text, hash }
  let debounce = null;

  function setStatus(state, extra) {
    chrome.storage.local.set({ [STATUS_KEY]: { state, extra: extra || '', at: Date.now() } });
  }

  function tripRoot() { return document.querySelector('app-trip-info'); }

  // ── DOM text extraction (TreeWalker; no clipboard) ──────
  function extractText(root) {
    const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TD','TH','TR','BLOCKQUOTE','SECTION','ARTICLE','ASIDE','MAIN','BR','FIGURE','FIGCAPTION','DT','DD','LABEL']);
    const SKIP  = new Set(['SCRIPT','STYLE','NOSCRIPT','HEAD','BUTTON','NAV','FOOTER','HEADER']);
    const SKIP_INPUT = new Set(['hidden','submit','button','reset','image','file','checkbox','radio']);
    function shouldSkip(el) {
      if (SKIP.has(el.tagName)) return true;
      const c = (el.className || '').toString().toLowerCase(), id = (el.id || '').toLowerCase();
      return /\b(nav|navbar|footer|header|sidebar|menu|ads?|cookie|banner|modal)\b/.test(c + ' ' + id);
    }
    let out = '';
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) { return n.nodeType === Node.ELEMENT_NODE && shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.nodeValue.trim()) out += n.nodeValue;
      } else {
        if (BLOCK.has(n.tagName) && out.length && !out.endsWith('\n')) out += '\n';
        if (n.tagName === 'INPUT') {
          const t = (n.type || 'text').toLowerCase();
          if (!SKIP_INPUT.has(t) && n.value && n.value.trim()) { if (!out.endsWith('\n')) out += '\n'; out += n.value.trim() + '\n'; }
        } else if (n.tagName === 'SELECT') {
          const s = n.options && n.options[n.selectedIndex];
          if (s && s.text.trim()) { if (!out.endsWith('\n')) out += '\n'; out += s.text.trim() + '\n'; }
        } else if (n.tagName === 'TEXTAREA' && n.value && n.value.trim()) {
          if (!out.endsWith('\n')) out += '\n'; out += n.value.trim() + '\n';
        }
      }
    }
    return L.normalizeText(out);
  }

  function takeSnapshot() {
    const root = tripRoot();
    if (!root) return;
    const text = extractText(root);
    if (!L.isValidSnapshot(text)) return;
    snapshot = { text, hash: L.fnv1aHash(text) };
    setStatus('monitoring', 'captured');
  }

  function scheduleSnapshot() {
    clearTimeout(debounce);
    debounce = setTimeout(takeSnapshot, 1000);
  }

  // ── In-page duplicate-confirm modal ─────────────────────
  function showDupModal(count, groupName) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.id = 'umrah-dup-modal';
      wrap.setAttribute('dir', 'rtl');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:Tahoma,Arial,sans-serif;';
      wrap.innerHTML =
        '<div style="background:#fff;max-width:360px;width:90%;border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center;">' +
          '<div style="font-size:32px">⚠️</div>' +
          '<div style="font-weight:700;margin:8px 0;color:#b45309">المجموعة موجودة مسبقاً</div>' +
          '<div style="font-size:14px;color:#444;margin-bottom:16px">يوجد ' + count + ' رحلة محفوظة للمجموعة "' + (groupName || '') + '". هل تريد الاستبدال أم الإيقاف؟</div>' +
          '<div style="display:flex;gap:10px;justify-content:center">' +
            '<button id="umrah-dup-overwrite" style="flex:1;padding:10px;border:0;border-radius:8px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer">🔄 استبدال</button>' +
            '<button id="umrah-dup-stop" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-weight:700;cursor:pointer">إيقاف</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      function close(decision) { wrap.remove(); resolve(decision); }
      wrap.querySelector('#umrah-dup-overwrite').addEventListener('click', () => close('overwrite'));
      wrap.querySelector('#umrah-dup-stop').addEventListener('click', () => close('stop'));
    });
  }

  // ── Finalize: send latest snapshot when leaving the page ─
  async function finalize() {
    if (!enabled || !snapshot) return;
    const snap = snapshot;
    snapshot = null;                                  // consume; avoid double-send
    const store = await chrome.storage.local.get([LASTSENT_KEY]);
    if (store[LASTSENT_KEY] === snap.hash) return;    // unchanged → skip

    setStatus('finalizing');
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'UMRAH_AUTO_FINALIZE', text: snap.text, hash: snap.hash });
    } catch (_) { setStatus('error', 'background unavailable'); return; }
    if (!res) { setStatus('error', 'no response'); return; }

    if (res.result === 'duplicate') {
      const decision = await showDupModal(res.count, res.groupName);
      if (decision === 'stop') { setStatus('stopped'); return; }
      try {
        const ov = await chrome.runtime.sendMessage({ type: 'UMRAH_AUTO_SEND_OVERWRITE', text: snap.text, hash: snap.hash });
        if (ov && ov.result === 'sent') setStatus('sent', String(ov.rows || 0));
        else setStatus(ov && ov.result === 'login-required' ? 'login-required' : 'error', ov && ov.message);
      } catch (_) { setStatus('error', 'overwrite failed'); }
      return;
    }
    // sent | no-group | login-required | error are also persisted by background;
    // mirror the terminal state locally for immediacy.
    if (res.result === 'sent') setStatus('sent', String(res.rows || 0));
    else setStatus(res.result, res.message);
  }

  // ── Page presence tracking ──────────────────────────────
  function evaluatePresence() {
    const present = !!tripRoot();
    if (present && !onPage) { onPage = true; setStatus('monitoring'); takeSnapshot(); }
    else if (!present && onPage) { onPage = false; finalize(); }
  }

  const mo = new MutationObserver(() => {
    if (!enabled) return;
    evaluatePresence();
    if (onPage) scheduleSnapshot();
  });

  function start() { mo.observe(document.body, { childList: true, subtree: true }); evaluatePresence(); }
  function stop()  { mo.disconnect(); onPage = false; snapshot = null; setStatus('disabled'); }

  // ── React to the on/off toggle ──────────────────────────
  function applyEnabled(val) {
    enabled = !!val;
    if (enabled) { setStatus('waiting'); start(); }
    else { stop(); }
  }

  chrome.storage.local.get([ENABLED_KEY], (r) => applyEnabled(r[ENABLED_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ENABLED_KEY]) applyEnabled(changes[ENABLED_KEY].newValue);
  });
})();
