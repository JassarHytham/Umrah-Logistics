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
  const GROUP_KEY    = 'umrah_active_group';
  const AUTOFILL_KEY = 'umrah_autofill';

  let enabled  = false;
  let onPage   = false;
  let snapshot = null;     // { text, hash }
  let activeTripRoot = null;
  let debounce = null;
  let dataMo   = null;     // focused MO on tripRoot with characterData
  let badgeEl  = null;     // on-page "saving to group" pill

  function setStatus(state, extra) {
    chrome.storage.local.set({ [STATUS_KEY]: { state, extra: extra || '', at: Date.now() } });
  }

  function tripRoot() { return document.querySelector('app-trip-info'); }
  function snapshotRoot(anchor) {
    if (!anchor) return null;
    const selectors = ['main','article','[role="main"]','#content','#main','.content','.main-content','.booking-details','.itinerary','.trip-details','[class*="itinerary"]','[class*="booking"]'];
    for (const selector of selectors) {
      try {
        const candidate = document.querySelector(selector);
        if (candidate && candidate.contains && candidate.contains(anchor)) return candidate;
      } catch (_) {}
    }
    return anchor;
  }

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

  function takeSnapshot(rootOverride) {
    const root = snapshotRoot(rootOverride || tripRoot());
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

  function captureLatestSnapshot() {
    clearTimeout(debounce);
    debounce = null;
    takeSnapshot(activeTripRoot || tripRoot());
  }

  // ── In-page duplicate-confirm modal ─────────────────────
  function showDupModal(count, groupName) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.id = 'umrah-dup-modal';
      wrap.setAttribute('dir', 'rtl');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:Tahoma,Arial,sans-serif;user-select:none;-webkit-user-select:none;';
      wrap.innerHTML =
        '<div style="background:#fff;max-width:420px;width:90%;border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center;">' +
          '<div style="font-size:32px">⚠️</div>' +
          '<div style="font-weight:700;margin:8px 0;color:#b45309">المجموعة موجودة مسبقاً</div>' +
          '<div id="umrah-dup-msg" style="font-size:14px;color:#444;margin-bottom:16px"></div>' +
          '<div style="display:grid;grid-template-columns:1fr;gap:10px;justify-content:center">' +
            '<button id="umrah-dup-add" style="padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">➕ إضافة كنسخة مكررة</button>' +
            '<button id="umrah-dup-overwrite" style="padding:10px;border:0;border-radius:8px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer">🔄 استبدال القديم</button>' +
            '<button id="umrah-dup-stop" style="padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;font-weight:700;cursor:pointer">إيقاف</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      // groupName traces back to untrusted page-scraped text — render as a
      // text node so no HTML in it is interpreted (count is numeric/safe).
      wrap.querySelector('#umrah-dup-msg').textContent =
        'يوجد ' + count + ' رحلة محفوظة للمجموعة "' + (groupName || '') + '". اختر طريقة المتابعة:';
      function close(decision) { wrap.remove(); resolve(decision); }
      wrap.querySelector('#umrah-dup-add').addEventListener('click', () => close('add'));
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
      const messageType = decision === 'add' ? 'UMRAH_AUTO_SEND_DUPLICATE' : 'UMRAH_AUTO_SEND_OVERWRITE';
      const failureLabel = decision === 'add' ? 'duplicate add failed' : 'overwrite failed';
      try {
        const ov = await chrome.runtime.sendMessage({ type: messageType, text: snap.text, hash: snap.hash });
        if (ov && ov.result === 'sent') setStatus('sent', String(ov.rows || 0));
        else setStatus(ov && ov.result === 'login-required' ? 'login-required' : 'error', ov && ov.message);
      } catch (_) { setStatus('error', failureLabel); }
      return;
    }
    // sent | no-group | login-required | error are also persisted by background;
    // mirror the terminal state locally for immediacy.
    if (res.result === 'sent') setStatus('sent', String(res.rows || 0));
    else setStatus(res.result, res.message);
  }

  // ── On-page "saving to group" badge ─────────────────────
  //  Always shows which group this trip will be attached to (or warns that
  //  none is selected), so a stale/previous group is never used silently.
  //  The ✕ button clears the captured group in one click → next finalize
  //  becomes a no-group no-op until a fresh group row is clicked.
  function clearGroup() { chrome.storage.local.remove([GROUP_KEY, AUTOFILL_KEY]); }

  function renderBadge(group) {
    if (!badgeEl) return;
    badgeEl.textContent = '';
    const hasGroup = !!(group && group.groupName);
    badgeEl.style.background = hasGroup ? '#111827' : '#b45309';
    const label = document.createElement('span');
    if (hasGroup) {
      label.appendChild(document.createTextNode('📍 سيتم الحفظ للمجموعة: '));
      // groupName/groupNo are page-scraped — keep them as text nodes.
      const g = document.createElement('strong');
      g.textContent = group.groupName + (group.groupNo ? ' (' + group.groupNo + ')' : '');
      label.appendChild(g);
    } else {
      label.textContent = '⚠️ لا توجد مجموعة محددة — لن يتم الحفظ';
    }
    badgeEl.appendChild(label);
    if (hasGroup) {
      const btn = document.createElement('button');
      btn.textContent = '✕ مسح';
      btn.style.cssText = 'margin-inline-start:10px;border:0;border-radius:12px;background:rgba(255,255,255,.2);color:#fff;font-weight:700;cursor:pointer;padding:3px 9px;font-family:inherit;font-size:12px;';
      btn.addEventListener('click', clearGroup);
      badgeEl.appendChild(btn);
    }
  }

  async function showBadge() {
    if (!badgeEl) {
      badgeEl = document.createElement('div');
      badgeEl.id = 'umrah-auto-badge';
      badgeEl.setAttribute('dir', 'rtl');
      // user-select:none keeps the badge out of any Select-All / clipboard
      // capture of the page (it lives in document.body, outside app-trip-info).
      badgeEl.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483646;display:flex;align-items:center;color:#fff;padding:8px 14px;border-radius:20px;font-family:Tahoma,Arial,sans-serif;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);user-select:none;-webkit-user-select:none;';
      document.body.appendChild(badgeEl);
    }
    const s = await chrome.storage.local.get([GROUP_KEY]);
    renderBadge(s[GROUP_KEY]);
  }

  function hideBadge() { if (badgeEl) { badgeEl.remove(); badgeEl = null; } }

  // ── Focused characterData watcher on the trip element ───
  // The main MO only watches childList — it misses Angular's text-node updates
  // when data binding fills in airport names, dates, and flight numbers.
  // This secondary MO on tripRoot() catches those characterData changes so the
  // debounce timer resets and the final snapshot includes real data.
  function startDataWatch() {
    if (dataMo) return;
    const root = tripRoot();
    if (!root) return;
    dataMo = new MutationObserver(() => { if (enabled && onPage) scheduleSnapshot(); });
    dataMo.observe(root, { childList: true, subtree: true, characterData: true });
  }
  function stopDataWatch() {
    if (dataMo) { dataMo.disconnect(); dataMo = null; }
  }

  // ── Page presence tracking ──────────────────────────────
  function evaluatePresence() {
    const root = tripRoot();
    const present = !!root;
    if (present && !onPage) {
      activeTripRoot = root;
      onPage = true;
      setStatus('monitoring');
      scheduleSnapshot();
      startDataWatch();
      showBadge();
    }
    else if (present) {
      activeTripRoot = root;
    }
    else if (!present && onPage) {
      captureLatestSnapshot();
      onPage = false;
      hideBadge();
      stopDataWatch();
      finalize();
      activeTripRoot = null;
    }
  }

  const mo = new MutationObserver(() => {
    if (!enabled) return;
    evaluatePresence();
    if (onPage) scheduleSnapshot();
  });

  function start() { mo.observe(document.body, { childList: true, subtree: true }); evaluatePresence(); }
  function stop()  { mo.disconnect(); stopDataWatch(); clearTimeout(debounce); debounce = null; onPage = false; activeTripRoot = null; snapshot = null; hideBadge(); setStatus('disabled'); }

  function finalizeBeforeUnload() {
    if (!enabled || !onPage) return;
    captureLatestSnapshot();
    finalize();
  }

  // ── React to the on/off toggle ──────────────────────────
  function applyEnabled(val) {
    enabled = !!val;
    if (enabled) { setStatus('waiting'); start(); }
    else { stop(); }
  }

  chrome.storage.local.get([ENABLED_KEY], (r) => applyEnabled(r[ENABLED_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[ENABLED_KEY]) applyEnabled(changes[ENABLED_KEY].newValue);
    // Keep the on-page badge in sync if the group is selected/cleared while
    // we're monitoring (e.g. cleared by the ✕ button or after a save).
    if (changes[GROUP_KEY] && enabled && onPage) renderBadge(changes[GROUP_KEY].newValue);
  });

  window.addEventListener('pagehide', finalizeBeforeUnload, { capture: true });
  window.addEventListener('beforeunload', finalizeBeforeUnload, { capture: true });
})();
