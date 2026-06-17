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
