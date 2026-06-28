// ══════════════════════════════════════════════════════
//  Umrah Logistics Capture — popup.js
// ══════════════════════════════════════════════════════

const STORAGE_KEY_URL   = 'umrah_server_url';
const STORAGE_KEY_TOKEN = 'umrah_token';
const STORAGE_KEY_GROUP = 'umrah_last_group';

// ── DOM refs ───────────────────────────────────────────
const loginView        = document.getElementById('loginView');
const captureView      = document.getElementById('captureView');
const statusDot        = document.getElementById('statusDot');
const serverUrlInput   = document.getElementById('serverUrl');
const loginUsername    = document.getElementById('loginUsername');
const loginPassword    = document.getElementById('loginPassword');
const loginBtn         = document.getElementById('loginBtn');
const loginBtnText     = document.getElementById('loginBtnText');
const loginSpinner     = document.getElementById('loginSpinner');
const loginError       = document.getElementById('loginError');
const serverLabel      = document.getElementById('serverLabel');
const manifestVersion  = document.getElementById('manifestVersion');
const logoutBtn        = document.getElementById('logoutBtn');
const checkUpdateBtn   = document.getElementById('checkUpdateBtn');
const updateStatus     = document.getElementById('updateStatus');
const capturePageBtn   = document.getElementById('capturePageBtn');
const capturedText     = document.getElementById('capturedText');
const captureHint      = document.getElementById('captureHint');
const groupNo          = document.getElementById('groupNo');
const groupName        = document.getElementById('groupName');
const agency           = document.getElementById('agency');
const groupCount       = document.getElementById('groupCount');
const dupWarning       = document.getElementById('dupWarning');
const dupTitle         = document.getElementById('dupTitle');
const dupDetail        = document.getElementById('dupDetail');
const sendBtn          = document.getElementById('sendBtn');
const sendBtnText      = document.getElementById('sendBtnText');
const sendSpinner      = document.getElementById('sendSpinner');
const overwriteBtn     = document.getElementById('overwriteBtn');
const overwriteBtnText = document.getElementById('overwriteBtnText');
const overwriteSpinner = document.getElementById('overwriteSpinner');
const sendError        = document.getElementById('sendError');
const sendSuccess      = document.getElementById('sendSuccess');
const resultSection    = document.getElementById('resultSection');
const resultList       = document.getElementById('resultList');
const openAppBtn       = document.getElementById('openAppBtn');

// ── State ──────────────────────────────────────────────
let serverUrl      = '';
let authToken      = '';
let dupCheckTimer  = null;   // debounce timer
let isDuplicate    = false;  // current duplicate state

// ══════════════════════════════════════════════════════
//  Init
// ══════════════════════════════════════════════════════
async function init() {
  if (manifestVersion) {
    manifestVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const stored = await chrome.storage.local.get([
    STORAGE_KEY_URL, STORAGE_KEY_TOKEN, STORAGE_KEY_GROUP, 'umrah_autofill'
  ]);

  serverUrl = stored[STORAGE_KEY_URL] || 'http://localhost:3000';
  authToken  = stored[STORAGE_KEY_TOKEN] || '';

  const autofill = stored['umrah_autofill'];
  const autofillFresh = autofill && (Date.now() - autofill.timestamp < 60_000);

  if (autofillFresh) {
    groupNo.value    = autofill.groupNo    || '';
    groupName.value  = autofill.groupName  || '';
    agency.value     = autofill.agency     || '';
    groupCount.value = autofill.count      || '';
    chrome.storage.local.remove('umrah_autofill');
  } else if (stored[STORAGE_KEY_GROUP]) {
    const g = stored[STORAGE_KEY_GROUP];
    groupNo.value    = g.groupNo    || '';
    groupName.value  = g.groupName  || '';
    agency.value     = g.agency     || '';
    groupCount.value = g.groupCount || '';
  }

  if (authToken) {
    showCaptureView();
    if (autofillFresh) {
      captureHint.textContent = `✅ تم اكتشاف المجموعة تلقائياً: ${autofill.groupNo} — ${autofill.groupName}`;
      captureHint.style.color = '#16a34a';
    }
    checkConnection();
    // Run duplicate check if group number is already populated
    if (groupNo.value.trim()) scheduleDupCheck();
  } else {
    serverUrlInput.value = serverUrl;
    showLoginView();
  }
}

// ══════════════════════════════════════════════════════
//  View switching
// ══════════════════════════════════════════════════════
function showLoginView() {
  loginView.classList.remove('hidden');
  captureView.classList.add('hidden');
  setStatus('disconnected');
}

function showCaptureView() {
  loginView.classList.add('hidden');
  captureView.classList.remove('hidden');
  try {
    serverLabel.textContent = new URL(serverUrl).host;
  } catch {
    serverLabel.textContent = serverUrl;
  }
  openAppBtn.href = serverUrl;
  updateSendButton();
}

function showUpdateStatus(message, tone = 'info') {
  if (!updateStatus) return;
  updateStatus.textContent = message;
  updateStatus.className = `hint update-status ${tone}`;
  updateStatus.classList.remove('hidden');
}

function clearUpdateStatus() {
  if (!updateStatus) return;
  updateStatus.textContent = '';
  updateStatus.className = 'hint update-status hidden';
}

function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
}

// ══════════════════════════════════════════════════════
//  Connection check
// ══════════════════════════════════════════════════════
async function checkConnection() {
  try {
    await fetchApi('/api/data', 'GET');
    setStatus('connected');
  } catch {
    setStatus('error');
  }
}

// ══════════════════════════════════════════════════════
//  Duplicate check
// ══════════════════════════════════════════════════════
function scheduleDupCheck() {
  clearTimeout(dupCheckTimer);
  dupCheckTimer = setTimeout(runDupCheck, 600);
}

async function runDupCheck() {
  const gNo = groupNo.value.trim();
  if (!gNo || !authToken) {
    hideDupWarning();
    return;
  }

  try {
    const res = await fetchApi(`/api/check/group/${encodeURIComponent(gNo)}`, 'GET');
    if (res.exists) {
      showDupWarning(res.count, gNo);
    } else {
      hideDupWarning();
    }
  } catch {
    // If endpoint doesn't exist yet or network error, fail silently
    hideDupWarning();
  }
}

function showDupWarning(count, gNo) {
  isDuplicate = true;
  dupWarning.classList.remove('hidden');
  dupTitle.textContent = `رقم المجموعة موجود مسبقاً`;
  dupDetail.textContent = `يوجد ${count} رحلة محفوظة للمجموعة "${gNo}". اختر كيف تريد المتابعة:`;

  // Rename main button to the non-overwrite duplicate option.
  sendBtnText.textContent = '➕ إضافة كنسخة مكررة';
  sendBtn.classList.add('has-duplicate');

  // Show overwrite button
  overwriteBtn.classList.remove('hidden');
  updateSendButton();
}

function hideDupWarning() {
  isDuplicate = false;
  dupWarning.classList.add('hidden');
  sendBtnText.textContent = '⚡ إرسال إلى النظام';
  sendBtn.classList.remove('has-duplicate');
  overwriteBtn.classList.add('hidden');
  updateSendButton();
}

// Trigger duplicate check when group number field changes
groupNo.addEventListener('input', () => {
  hideDupWarning();   // hide stale warning immediately on change
  scheduleDupCheck();
  updateSendButton();
});

// ══════════════════════════════════════════════════════
//  Auth
// ══════════════════════════════════════════════════════
loginBtn.addEventListener('click', async () => {
  const url      = serverUrlInput.value.trim().replace(/\/$/, '');
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!url || !username || !password) { showLoginError('يرجى تعبئة جميع الحقول'); return; }
  setLoginLoading(true);
  loginError.classList.add('hidden');
  try {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { showLoginError(data.error || 'فشل تسجيل الدخول'); return; }
    serverUrl = url;
    authToken  = data.token;
    await chrome.storage.local.set({ [STORAGE_KEY_URL]: serverUrl, [STORAGE_KEY_TOKEN]: authToken });
    showCaptureView();
    setStatus('connected');
  } catch {
    showLoginError(`لا يمكن الاتصال بالخادم: ${url}`);
  } finally {
    setLoginLoading(false);
  }
});

logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove([STORAGE_KEY_TOKEN]);
  authToken = '';
  serverUrlInput.value = serverUrl;
  loginPassword.value = '';
  clearUpdateStatus();
  showLoginView();
});

if (checkUpdateBtn) {
  checkUpdateBtn.addEventListener('click', () => {
    if (!chrome.runtime?.requestUpdateCheck) {
      showUpdateStatus('Chrome لا يدعم فحص التحديث من هذا السياق', 'error');
      return;
    }

    showUpdateStatus('جارٍ فحص التحديث...', 'info');
    checkUpdateBtn.disabled = true;

    chrome.runtime.requestUpdateCheck((status) => {
      if (chrome.runtime.lastError) {
        showUpdateStatus(`تعذر فحص التحديث: ${chrome.runtime.lastError.message}`, 'error');
        checkUpdateBtn.disabled = false;
        return;
      }

      if (status === 'update_available') {
        showUpdateStatus('تم العثور على تحديث. ستُعاد الإضافة الآن.', 'success');
        setTimeout(() => chrome.runtime.reload(), 1200);
        return;
      }

      if (status === 'no_update') {
        showUpdateStatus('أنت على أحدث إصدار.', 'success');
      } else if (status === 'throttled') {
        showUpdateStatus('Chrome أجّل الفحص مؤقتاً. أعد المحاولة لاحقاً.', 'error');
      } else {
        showUpdateStatus(`حالة التحديث: ${status}`, 'info');
      }

      setTimeout(() => {
        checkUpdateBtn.disabled = false;
      }, 800);
    });
  });
}

function setLoginLoading(loading) {
  loginBtnText.textContent = loading ? 'جاري الاتصال...' : 'تسجيل الدخول وحفظ';
  loginSpinner.classList.toggle('hidden', !loading);
  loginBtn.disabled = loading;
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

// ══════════════════════════════════════════════════════
//  Page Text Capture
//
//  Strategy 1 (primary): inject selectAll + execCommand('copy')
//  into the tab — this replicates Cmd+A + Cmd+C exactly,
//  including input field values the DOM walker misses.
//  Then read back via navigator.clipboard.readText().
//
//  Strategy 2 (fallback): TreeWalker DOM extraction,
//  used if clipboard read fails for any reason.
// ══════════════════════════════════════════════════════
capturePageBtn.addEventListener('click', async () => {
  capturePageBtn.textContent = '⏳ جاري القراءة...';
  capturePageBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let text = '';
    let usedClipboard = false;

    // ── Strategy 1: selectAll + copy → read clipboard ──
    try {
      // Inject selectAll + execCommand copy into the live page.
      // Chrome extensions can do this even without a page-level
      // user gesture because the extension popup click is the gesture.
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          document.execCommand('selectAll');
          const ok = document.execCommand('copy');
          // Immediately deselect so the page looks normal
          window.getSelection()?.removeAllRanges();
          return ok;
        }
      });

      if (result?.result === true) {
        // Brief pause — lets the OS clipboard write complete
        await new Promise(r => setTimeout(r, 150));
        const raw = await navigator.clipboard.readText();
        if (raw && raw.trim().length > 20) {
          text = normalizeText(raw);
          usedClipboard = true;
        }
      }
    } catch (_) {
      // Clipboard read blocked or not permitted — fall through
    }

    // ── Strategy 2: TreeWalker DOM fallback ───────────
    if (!text || text.trim().length < 20) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageText
      });
      text = results?.[0]?.result || '';
    }

    if (text.trim().length > 20) {
      setTextArea(text.trim());
      captureHint.textContent = `✅ تم التقاط ${text.trim().length} حرف` +
        (usedClipboard ? ' (نسخ تلقائي)' : ' (قراءة DOM)');
      captureHint.style.color = '';
    } else {
      captureHint.textContent = '⚠️ لم يتم العثور على نص كافٍ في الصفحة';
    }

  } catch (err) {
    captureHint.textContent = `❌ تعذر قراءة الصفحة: ${err.message}`;
  } finally {
    capturePageBtn.textContent = '📄 التقاط نص الصفحة';
    capturePageBtn.disabled = false;
  }
});

// ── Text normalizer (used for both clipboard and DOM text) ─
function normalizeText(raw) {
  return raw
    // Non-standard whitespace
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
    // "label: value" → "label\nvalue" so the parser finds dates
    .replace(/(تاريخ[^:\n\r]{0,30}):\s*/g,     '$1\n')
    .replace(/(وقت[^:\n\r]{0,20}):\s*/g,        '$1\n')
    .replace(/(المطار[^:\n\r]{0,20}):\s*/g,     '$1\n')
    .replace(/(رقم الرحلة[^:\n\r]{0,10}):\s*/g, '$1\n')
    // Normalise whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Page text extractor (injected into tab) ───────────
function extractPageText() {
  function normalizeText(raw) {
    return raw
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
      .replace(/(تاريخ[^:\n\r]{0,30}):\s*/g, '$1\n')
      .replace(/(وقت[^:\n\r]{0,20}):\s*/g, '$1\n')
      .replace(/(المطار[^:\n\r]{0,20}):\s*/g, '$1\n')
      .replace(/(رقم الرحلة[^:\n\r]{0,10}):\s*/g, '$1\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TD','TH','TR','BLOCKQUOTE','SECTION','ARTICLE','ASIDE','MAIN','BR','FIGURE','FIGCAPTION','DT','DD','LABEL']);
  const SKIP  = new Set(['SCRIPT','STYLE','NOSCRIPT','HEAD','BUTTON','NAV','FOOTER','HEADER']);
  const SKIP_INPUT = new Set(['hidden','submit','button','reset','image','file','checkbox','radio']);
  function shouldSkip(el) {
    if (SKIP.has(el.tagName)) return true;
    const c = (el.className || '').toString().toLowerCase(), id = (el.id || '').toLowerCase();
    return /\b(nav|navbar|footer|header|sidebar|menu|ads?|cookie|banner|modal)\b/.test(c + ' ' + id);
  }
  function walk(root) {
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
    return out;
  }
  const selectors = ['main','article','[role="main"]','#content','#main','.content','.main-content','.booking-details','.itinerary','.trip-details','[class*="itinerary"]','[class*="booking"]'];
  for (const s of selectors) {
    try { const el = document.querySelector(s); if (el && !shouldSkip(el)) { const t = walk(el); if (t.trim().length > 50) return normalizeText(t); } } catch {}
  }
  return normalizeText(walk(document.body));
}

// ── Set textarea ──────────────────────────────────────
function setTextArea(text) {
  capturedText.value = text;
  capturedText.classList.add('has-text');
  updateSendButton();
}

capturedText.addEventListener('input', () => {
  capturedText.classList.toggle('has-text', capturedText.value.trim().length > 10);
  updateSendButton();
  resultSection.classList.add('hidden');
  sendSuccess.classList.add('hidden');
  sendError.classList.add('hidden');
});

[groupName, agency, groupCount].forEach(el => el.addEventListener('input', updateSendButton));

// ══════════════════════════════════════════════════════
//  Send Button State
// ══════════════════════════════════════════════════════
function updateSendButton() {
  const hasText  = capturedText.value.trim().length > 10;
  const hasGroup = groupNo.value.trim() && groupName.value.trim() && groupCount.value.trim();
  const ready    = !!(hasText && hasGroup);
  sendBtn.disabled = !ready;
  overwriteBtn.disabled = !ready;
}

// ══════════════════════════════════════════════════════
//  Send — shared logic
// ══════════════════════════════════════════════════════
async function doSend(overwrite) {
  const text  = capturedText.value.trim();
  const gNo   = groupNo.value.trim();
  const gName = groupName.value.trim();
  const gAgency = agency.value.trim();
  const gCnt  = groupCount.value.trim();
  if (!text || !gNo || !gName || !gCnt) return;

  sendError.classList.add('hidden');
  sendSuccess.classList.add('hidden');
  resultSection.classList.add('hidden');

  if (overwrite) setOverwriteLoading(true);
  else setSendLoading(true);

  try {
    const res = await fetchApi('/api/ingest/text', 'POST', {
      text, groupNo: gNo, groupName: gName, agency: gAgency, count: gCnt, overwrite
    });
    if (!res.success) throw new Error(res.error || 'فشل الإرسال');

    await chrome.storage.local.set({ [STORAGE_KEY_GROUP]: { groupNo: gNo, groupName: gName, agency: gAgency, groupCount: gCnt } });

    const count = res.rows?.length || 0;
    const action = overwrite ? 'استبدال' : (isDuplicate ? 'إضافة كنسخة مكررة' : 'إضافة');
    sendSuccess.textContent = `✅ تم ${action} ${count} رحلة للمجموعة "${gName}"`;
    sendSuccess.classList.remove('hidden');
    setStatus('connected');

    if (res.rows?.length > 0) renderResults(res.rows);

    capturedText.value = '';
    capturedText.classList.remove('has-text');
    hideDupWarning();
    updateSendButton();
  } catch (err) {
    if (err.message?.includes('401')) {
      await chrome.storage.local.remove([STORAGE_KEY_TOKEN]);
      authToken = '';
      showLoginView();
      return;
    }
    sendError.textContent = `❌ ${err.message}`;
    sendError.classList.remove('hidden');
    setStatus('error');
  } finally {
    setSendLoading(false);
    setOverwriteLoading(false);
  }
}

sendBtn.addEventListener('click',      () => doSend(false));
overwriteBtn.addEventListener('click', () => doSend(true));

function setSendLoading(on) {
  sendBtnText.textContent = on ? 'جاري الإرسال...' : (isDuplicate ? '➕ إضافة كنسخة مكررة' : '⚡ إرسال إلى النظام');
  sendSpinner.classList.toggle('hidden', !on);
  sendBtn.disabled = on;
}

function setOverwriteLoading(on) {
  overwriteBtnText.textContent = on ? 'جاري الاستبدال...' : '🔄 استبدال — حذف القديم وإضافة الجديد';
  overwriteSpinner.classList.toggle('hidden', !on);
  overwriteBtn.disabled = on;
}

// ══════════════════════════════════════════════════════
//  Result Rendering
// ══════════════════════════════════════════════════════
function renderResults(rows) {
  resultList.innerHTML = '';
  rows.forEach(row => {
    const div = document.createElement('div');
    div.className = 'result-row';
    const type = row.Column1 || '';
    let badge = 'transit';
    if (type.includes('وصول'))   badge = 'arrival';
    if (type.includes('مغادرة')) badge = 'departure';
    div.innerHTML = `
      <span class="result-badge ${badge}">${type}</span>
      <span class="result-detail">${row.from || '?'} → ${row.to || '?'}
        ${row.flight && row.flight !== '-' ? `<br><small>✈ ${row.flight}</small>` : ''}
      </span>
      <span class="result-date">${row.date || ''} ${row.time || ''}</span>`;
    resultList.appendChild(div);
  });
  resultSection.classList.remove('hidden');
}

// ══════════════════════════════════════════════════════
//  API helper
// ══════════════════════════════════════════════════════
async function fetchApi(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${serverUrl}${path}`, opts);
  if (res.status === 401) throw new Error('401 Unauthorized');
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('الخادم لم يرد بـ JSON');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════
//  Boot
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
