// ══════════════════════════════════════════════════════
//  auto.js  (NEW popup script)
//  Owns the "تلقائي" tab: tab switching, on/off toggle, live status.
//  Does NOT touch the manual view logic in popup.js.
// ══════════════════════════════════════════════════════
(function () {
  const ENABLED_KEY = 'umrah_auto_enabled';
  const STATUS_KEY  = 'umrah_auto_status';
  const RESULT_KEY  = 'umrah_auto_result';
  const GROUP_KEY   = 'umrah_active_group';

  const tabManual  = document.getElementById('tabManual');
  const tabAuto    = document.getElementById('tabAuto');
  const manualPane = document.getElementById('manualPane');
  const autoPane   = document.getElementById('autoPane');
  const toggle     = document.getElementById('autoToggle');
  const dot        = document.getElementById('autoDot');
  const statusText = document.getElementById('autoStatusText');
  const groupEl    = document.getElementById('autoGroup');
  const lastSync   = document.getElementById('autoLastSync');
  const rowsEl     = document.getElementById('autoRows');

  const STATUS_MAP = {
    disabled:         { dot: '',     text: 'غير مفعّل' },
    waiting:          { dot: 'blue', text: 'بانتظار صفحة الرحلة' },
    monitoring:       { dot: 'green',text: '🟢 جارٍ المراقبة — الصفحة مفتوحة' },
    finalizing:       { dot: 'blue', text: 'جارٍ المعالجة…' },
    sending:          { dot: 'blue', text: '📤 جارٍ الإرسال…' },
    sent:             { dot: 'green',text: '✅ تم الإرسال' },
    'no-group':       { dot: 'amber',text: '⚠️ لا توجد مجموعة محددة' },
    'missing-count':  { dot: 'amber',text: '⚠️ عدد المعتمرين غير متوفر — استخدم تبويب يدوي' },
    stopped:          { dot: 'amber',text: 'أُوقف بواسطة المستخدم' },
    'login-required': { dot: 'red',  text: '⚠️ سجّل الدخول من تبويب "يدوي"' },
    error:            { dot: 'red',  text: '❌ خطأ في الإرسال' }
  };

  function showTab(which) {
    const auto = which === 'auto';
    autoPane.classList.toggle('hidden', !auto);
    manualPane.classList.toggle('hidden', auto);
    tabAuto.classList.toggle('active', auto);
    tabManual.classList.toggle('active', !auto);
  }
  tabManual.addEventListener('click', () => showTab('manual'));
  tabAuto.addEventListener('click',   () => showTab('auto'));

  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ [ENABLED_KEY]: toggle.checked });
  });

  function fmtTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('ar'); } catch (_) { return '—'; }
  }
  function renderStatus(st) {
    const key = st && st.state ? st.state : 'disabled';
    const m = STATUS_MAP[key] || STATUS_MAP.disabled;
    dot.className = 'auto-dot' + (m.dot ? ' ' + m.dot : '');
    statusText.textContent = m.text + (st && st.extra ? ` (${st.extra})` : '');
  }
  function renderResult(r) {
    if (!r) { lastSync.textContent = '—'; rowsEl.textContent = '—'; return; }
    lastSync.textContent = fmtTime(r.at);
    rowsEl.textContent = (r.rows != null ? r.rows : '—');
  }
  function renderGroup(g) {
    groupEl.textContent = g && g.groupName ? `${g.groupName} (${g.groupNo})` : '—';
  }

  async function refresh() {
    const s = await chrome.storage.local.get([ENABLED_KEY, STATUS_KEY, RESULT_KEY, GROUP_KEY]);
    toggle.checked = !!s[ENABLED_KEY];
    renderStatus(s[ENABLED_KEY] ? s[STATUS_KEY] : { state: 'disabled' });
    renderResult(s[RESULT_KEY]);
    renderGroup(s[GROUP_KEY]);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STATUS_KEY]) renderStatus(toggle.checked ? changes[STATUS_KEY].newValue : { state: 'disabled' });
    if (changes[RESULT_KEY]) renderResult(changes[RESULT_KEY].newValue);
    if (changes[GROUP_KEY])  renderGroup(changes[GROUP_KEY].newValue);
    if (changes[ENABLED_KEY]) refresh();
  });

  refresh();
})();
