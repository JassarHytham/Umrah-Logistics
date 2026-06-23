// ══════════════════════════════════════════════════════
//  Umrah Logistics Capture — content.js
//  Injected into nusuk.sa pages.
//
//  Two independent strategies to detect the gear button:
//  1. Click event via composedPath() (handles Angular wrapping)
//  2. MutationObserver on aria-expanded (ngBootstrap toggle)
//
//  Both write to chrome.storage.local → popup reads on open.
// ══════════════════════════════════════════════════════

(function () {
  if (window.__umrahCaptureInjected) return;
  window.__umrahCaptureInjected = true;

  console.log('[Umrah Capture] Loaded on:', location.href);

  // ── Helpers ──────────────────────────────────────────
  function cellText(td) {
    if (!td) return '';
    return (td.innerText || td.textContent || '')
      .replace(/\s+/g, ' ').trim();
  }

  function extractRowData(row) {
    if (window.UmrahAutoLogic && typeof window.UmrahAutoLogic.extractGroupRowData === 'function') {
      return window.UmrahAutoLogic.extractGroupRowData(row, cellText);
    }
    return {
      groupNo:   cellText(row.querySelector('td[id="groupNumber"]')),
      groupName: cellText(row.querySelector('td[id="groupName"]')),
      agency:    cellText(row.querySelector('td[id="eaName"]')),
      count:     cellText(row.querySelector('td[id="mutamerNumber"]')),
    };
  }

  function isCogButton(el) {
    return el &&
      el.tagName === 'BUTTON' &&
      el.innerHTML.includes('pi-cog');
  }

  function saveAndFlash(row, data, source) {
    if (!data.groupNo || !data.groupName) return;
    const payload = { ...data, timestamp: Date.now(), source };

    chrome.storage.local.set({ umrah_autofill: payload }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Umrah Capture] Storage error:', chrome.runtime.lastError.message);
      } else {
        console.log('[Umrah Capture] Saved via', source, payload);
      }
    });

    // Flash the row green
    const prev = row.style.cssText;
    row.style.outline = '2px solid #22c55e';
    row.style.outlineOffset = '-2px';
    setTimeout(() => {
      row.style.outline = prev ? '' : 'none';
      row.style.outlineOffset = '';
    }, 800);
  }

  // ══════════════════════════════════════════════════════
  //  Strategy 1: Click listener using composedPath()
  //  composedPath() gives the full event path even when
  //  Angular re-wraps or stops propagation at higher levels
  // ══════════════════════════════════════════════════════
  document.addEventListener('click', function (e) {
    const path = e.composedPath ? e.composedPath() : [];

    let btn = null;
    for (const el of path) {
      if (isCogButton(el)) { btn = el; break; }
    }
    // fallback: walk up from target
    if (!btn && e.target && e.target.closest) {
      const candidate = e.target.closest('button');
      if (isCogButton(candidate)) btn = candidate;
    }

    if (!btn) return;

    const row = btn.closest('tr');
    if (!row) return;

    saveAndFlash(row, extractRowData(row), 'click');
  }, true); // capture phase — runs before Angular

  // ══════════════════════════════════════════════════════
  //  Strategy 2: MutationObserver watching aria-expanded
  //  When ngBootstrap opens the dropdown it sets
  //  aria-expanded="true" on the toggle button.
  //  This fires even if click events are swallowed.
  // ══════════════════════════════════════════════════════
  const mo = new MutationObserver(function (mutations) {
    for (const mut of mutations) {
      if (mut.type !== 'attributes') continue;
      if (mut.attributeName !== 'aria-expanded') continue;

      const el = mut.target;
      if (!isCogButton(el)) continue;
      if (el.getAttribute('aria-expanded') !== 'true') continue;

      const row = el.closest('tr');
      if (!row) continue;

      saveAndFlash(row, extractRowData(row), 'aria-expanded');
    }
  });

  // Start observing — retry until the table is rendered
  function startObserver() {
    // Watch the whole document body for attribute mutations
    // (subtree:true catches all nested elements)
    mo.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['aria-expanded']
    });
    console.log('[Umrah Capture] MutationObserver active');
  }

  // document.body is always present at document_idle
  startObserver();

  // Re-attach after Angular SPA navigation (catches route changes)
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      console.log('[Umrah Capture] SPA navigation detected, observer already running');
    }
  }, 1500);

})();
