// ══════════════════════════════════════════════════════
//  Umrah Logistics Capture — background.js (service worker)
//  Handles context menu and optional background tasks
// ══════════════════════════════════════════════════════

// Install context menu on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'umrah-capture-selection',
    title: 'إرسال النص المحدد → Umrah Logistics',
    contexts: ['selection']
  });
});

// Handle context menu click → open popup with captured text
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'umrah-capture-selection' && info.selectionText) {
    // Store selected text temporarily so popup can read it on open
    chrome.storage.session?.set({
      umrah_pending_text: info.selectionText
    });
    // Open the popup
    chrome.action.openPopup?.();
  }
});

// ══════════════════════════════════════════════════════
//  AUTO-CAPTURE SUPPORT (appended; existing code above unchanged)
//  • Mirrors the selected group so it survives the wizard steps.
//  • Performs the authenticated duplicate-check + ingest POST.
//    Network runs HERE (not in the content script) to avoid the
//    page's CORS/CSP restrictions.
//  • Shows the green badge + notification on success.
// ══════════════════════════════════════════════════════
(function () {
  const URL_KEY      = 'umrah_server_url';
  const TOKEN_KEY    = 'umrah_token';
  const REFRESH_TOKEN_KEY = 'umrah_refresh_token';
  const AUTOFILL_KEY = 'umrah_autofill';
  const GROUP_KEY    = 'umrah_active_group';
  const STATUS_KEY   = 'umrah_auto_status';
  const RESULT_KEY   = 'umrah_auto_result';
  const LASTSENT_KEY = 'umrah_auto_lastsent';

  // Fixed prod server URL, baked into the prod manifest at package time so
  // production installs never expose/require a server-URL field. Staging
  // manifests carry no such field, so staging keeps the editable URL.
  const FIXED_SERVER_URL = chrome.runtime.getManifest().umrah_fixed_server_url || '';

  // Keeps the rotating refresh token perpetually renewed so the extension
  // never forces a re-login as long as Chrome runs this alarm at least once
  // every 30 days (the refresh token's lifetime). Runs well inside the 8h
  // access-token window so a fresh access token is always on hand too.
  const REFRESH_ALARM_NAME = 'umrah-proactive-refresh';
  const REFRESH_ALARM_PERIOD_MINUTES = 60;

  function scheduleProactiveRefresh() {
    chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: REFRESH_ALARM_PERIOD_MINUTES });
  }
  chrome.runtime.onInstalled.addListener(scheduleProactiveRefresh);
  chrome.runtime.onStartup.addListener(scheduleProactiveRefresh);
  scheduleProactiveRefresh();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REFRESH_ALARM_NAME) return;
    (async () => {
      const base = await apiBase();
      if (base.refreshToken) await refreshAccessToken(base);
    })();
  });

  function get(keys) { return chrome.storage.local.get(keys); }
  function set(obj)  { return chrome.storage.local.set(obj); }
  function setStatus(state, extra) { set({ [STATUS_KEY]: { state, extra: extra || '', at: Date.now() } }); }

  // Mirror group-row capture (umrah_autofill) → persistent active group.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const af = changes[AUTOFILL_KEY];
    if (af && af.newValue && af.newValue.groupNo && af.newValue.groupName) {
      set({ [GROUP_KEY]: {
        groupNo: af.newValue.groupNo,
        groupName: af.newValue.groupName,
        agency: af.newValue.agency || '',
        count: af.newValue.count || ''
      }});
    }
  });

  function badge(text, color) {
    try {
      chrome.action.setBadgeText({ text: text || '' });
      if (color) chrome.action.setBadgeBackgroundColor({ color });
    } catch (_) {}
  }
  function notify(title, message) {
    try {
      chrome.notifications.create('umrah-auto-sent', { type: 'basic', iconUrl: 'icons/icon128.png', title, message });
    } catch (_) {}
  }

  async function apiBase() {
    const s = await get([URL_KEY, TOKEN_KEY, REFRESH_TOKEN_KEY]);
    return {
      url: FIXED_SERVER_URL || (s[URL_KEY] || '').replace(/\/$/, ''),
      token: s[TOKEN_KEY] || '',
      refreshToken: s[REFRESH_TOKEN_KEY] || ''
    };
  }

  async function refreshAccessToken(base) {
    if (!base.refreshToken) return false;
    try {
      const res = await fetch(`${base.url}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: base.refreshToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.token || !data.refreshToken) return false;
      base.token = data.token;
      base.refreshToken = data.refreshToken;
      await set({ [TOKEN_KEY]: data.token, [REFRESH_TOKEN_KEY]: data.refreshToken });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function fetchWithAuth(base, path, options = {}) {
    const request = () => fetch(`${base.url}${path}`, {
      ...options,
      headers: { ...options.headers, 'Authorization': `Bearer ${base.token}` }
    });
    let res = await request();
    if (res.status === 401 && await refreshAccessToken(base)) res = await request();
    return res;
  }

  async function checkDuplicate(base, groupNo) {
    const res = await fetchWithAuth(base, `/api/check/group/${encodeURIComponent(groupNo)}`);
    if (res.status === 401) return { auth: false };
    if (!res.ok) return { auth: true, exists: false, count: 0 };
    const data = await res.json().catch(() => ({}));
    return { auth: true, exists: !!data.exists, count: data.count || 0 };
  }

  async function ingest(base, group, text, overwrite) {
    const res = await fetchWithAuth(base, '/api/ingest/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, groupNo: group.groupNo, groupName: group.groupName,
        agency: group.agency || '',
        count: group.count, overwrite: !!overwrite
      })
    });
    if (res.status === 401) return { auth: false };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { auth: true, ok: false, message: data.error || ('HTTP ' + res.status) };
    return { auth: true, ok: true, rows: (data.rows || []).length };
  }

  async function doSend(group, text, hash, overwrite) {
    const base = await apiBase();
    if (!base.token && !(await refreshAccessToken(base))) { setStatus('login-required'); badge('!', '#dc2626'); return { result: 'login-required' }; }
    const r = await ingest(base, group, text, overwrite);
    if (!r.auth) { setStatus('login-required'); badge('!', '#dc2626'); return { result: 'login-required' }; }
    if (!r.ok)   { setStatus('error', r.message); badge('!', '#dc2626'); return { result: 'error', message: r.message }; }
    await set({
      [LASTSENT_KEY]: hash,
      [RESULT_KEY]: { groupNo: group.groupNo, groupName: group.groupName, rows: r.rows, at: Date.now() }
    });
    // Forget the group after a successful save so the next trip can't be
    // silently attached to this (now stale) group. A fresh group-row click
    // is required to capture again.
    await chrome.storage.local.remove([GROUP_KEY, AUTOFILL_KEY]);
    setStatus('sent', String(r.rows));
    badge('✓', '#16a34a');
    notify('تم الإرسال', `تم إرسال ${r.rows} رحلة للمجموعة "${group.groupName}"`);
    setTimeout(() => badge(''), 6000);
    return { result: 'sent', rows: r.rows };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'UMRAH_AUTO_FINALIZE') {
      (async () => {
        const s = await get([GROUP_KEY]);
        const group = s[GROUP_KEY];
        if (!group || !group.groupNo || !group.groupName) { setStatus('no-group'); sendResponse({ result: 'no-group' }); return; }
        if (!group.count) { setStatus('missing-count'); sendResponse({ result: 'missing-count' }); return; }
        const base = await apiBase();
        if (!base.token && !(await refreshAccessToken(base))) { setStatus('login-required'); badge('!', '#dc2626'); sendResponse({ result: 'login-required' }); return; }
        setStatus('sending');
        const dup = await checkDuplicate(base, group.groupNo).catch(() => ({ auth: true, exists: false, count: 0 }));
        if (dup.auth === false) { setStatus('login-required'); badge('!', '#dc2626'); sendResponse({ result: 'login-required' }); return; }
        if (dup.exists) { sendResponse({ result: 'duplicate', count: dup.count, groupName: group.groupName }); return; }
        sendResponse(await doSend(group, msg.text, msg.hash, false));
      })();
      return true;   // keep sendResponse alive (async)
    }

    if (msg.type === 'UMRAH_AUTO_SEND_OVERWRITE') {
      (async () => {
        const s = await get([GROUP_KEY]);
        const group = s[GROUP_KEY];
        if (!group || !group.groupNo) { sendResponse({ result: 'no-group' }); return; }
        if (!group.count) { sendResponse({ result: 'missing-count' }); return; }
        sendResponse(await doSend(group, msg.text, msg.hash, true));
      })();
      return true;   // async
    }

    if (msg.type === 'UMRAH_AUTO_SEND_DUPLICATE') {
      (async () => {
        const s = await get([GROUP_KEY]);
        const group = s[GROUP_KEY];
        if (!group || !group.groupNo) { sendResponse({ result: 'no-group' }); return; }
        if (!group.count) { sendResponse({ result: 'missing-count' }); return; }
        sendResponse(await doSend(group, msg.text, msg.hash, false));
      })();
      return true;   // async
    }
  });
})();
