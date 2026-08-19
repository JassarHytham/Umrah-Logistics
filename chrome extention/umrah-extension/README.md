# Umrah Logistics Capture — Chrome Extension

A Chrome extension that captures itinerary text from any webpage and sends it directly to your Umrah Logistics Pro system. No copy-pasting.

---

## How It Works

```
You browse to a booking page
        ↓
Click the extension icon
        ↓
Select text on page (or capture full page)
        ↓
Fill group info (No, Name, Count)
        ↓
Click "إرسال إلى النظام"
        ↓
Rows appear in your logistics table instantly
```

---

## Install

The extension is published on the Chrome Web Store — installing from there is the
supported path and updates arrive automatically.

To load a local build instead (developers only):

1. Run `node scripts/package-extension.mjs` from the repo root, or just use this folder directly
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (toggle top-right)
4. Click **"Load unpacked"** and select this folder

---

## First-Time Login

1. Click the extension icon
2. Enter your **Umrah Logistics username and password**
3. Click **تسجيل الدخول وحفظ**
4. You're connected — the dot turns green ✅

There is no server-URL field: every install talks to the server baked into
`config.js`. Your login is saved and renews itself in the background, so you stay
signed in until you log out.

---

## Settings (⚙️)

The gear button in the popup header opens the settings panel, from anywhere in the
extension. It shows:

- **الإصدار** — the installed version, straight from the manifest
- **الخادم الحالي** — the server this install is talking to
- **وضع المطوّر** — a checkbox that unlocks an editable server URL. Off for
  everyone by default; turning it back off clears the override and snaps the
  extension to the shipped default.
- **تسجيل الخروج** — ends the session (shown only while signed in)

---

## Usage

### Option A — Capture selected text (recommended for accuracy)
1. On the booking/itinerary page, **highlight the text** you want
2. Click the extension icon
3. Click **"📋 التقاط النص المحدد"**
4. The text appears in the box — review/edit if needed

### Option B — Capture entire page
1. Navigate to the itinerary page
2. Click the extension icon
3. Click **"📄 التقاط نص الصفحة كاملاً"**
4. Extension extracts the main content area text

### Option C — Right-click shortcut
1. Select text on any page
2. **Right-click → "إرسال النص المحدد → Umrah Logistics"**
3. Extension opens with the text pre-loaded

### Complete the capture
1. Verify/edit the captured text
2. Fill in **رقم المجموعة**, **اسم المجموعة**, **العدد**
   (the last values you used are remembered for speed)
3. Click **"⚡ إرسال إلى النظام"**
4. See the extracted trips listed below

---

## What the Extension Sends

The extension sends a POST request to:
```
POST {your-server}/api/ingest/text
Authorization: Bearer <your-jwt-token>
Content-Type: application/json

{
  "text": "رحلة الوصول\nتاريخ الوصول: 15/06/2026...",
  "groupNo": "G-001",
  "groupName": "مجموعة الرياض",
  "count": "4"
}
```

The server runs `parseItineraryText()` on it, prepends the new rows to your existing data, and returns the extracted rows. Identical to what happens when you paste manually — just without the paste.

---

## Files

```
umrah-logistics-extension/
├── manifest.json         Chrome Extension config (Manifest V3)
├── popup.html            Extension popup UI
├── popup.css             Styles
├── popup.js              Logic: auth, settings, capture, send
├── config.js             Default server URL, shared by popup + service worker
├── background.js         Service worker (context menu, auto-capture, token refresh)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             This file
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "لا يمكن الاتصال بالخادم" | Check server URL and that `npm run dev` is running |
| "لم يتم استخراج أي رحلات" | The text doesn't match the expected Arabic format — check `parseItineraryText()` in parser.ts |
| "401 Unauthorized" | Token expired — open ⚙️ settings, log out, then log in again |
| Page capture gets nav/footer text | Use selection mode instead — select just the itinerary block |
| Extension not updating | Go to `chrome://extensions` and click the reload ↺ button |

---

## Permissions Explained

| Permission | Why |
|---|---|
| `activeTab` | Read the currently open tab to capture text |
| `scripting` | Inject the text-extraction function into the page |
| `storage` | Save your auth token and settings locally |
| `host_permissions: <all_urls>` | Make API calls to your server (any URL) |
