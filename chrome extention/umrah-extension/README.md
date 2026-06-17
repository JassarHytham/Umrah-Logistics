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

## Setup: 2 Steps

### Step 1 — Add the endpoint to your server

Open `server.ts` in your Umrah-Logistics project and make 2 changes:

**Change 1** — Update the import at the top:
```typescript
// BEFORE:
import { parseDateTime } from "./utils/parser.js";

// AFTER:
import { parseDateTime, parseItineraryText, getCarType } from "./utils/parser.js";
```

**Change 2** — Paste the contents of `SERVER_ENDPOINT.ts` (in this folder) into `server.ts`, just before this line:
```typescript
// Vite middleware for development
if (process.env.NODE_ENV !== "production" ...
```

Then restart your server: `npm run dev`

---

### Step 2 — Install the Chrome Extension

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer Mode** (toggle top-right)
3. Click **"Load unpacked"**
4. Select this entire folder (`umrah-logistics-extension/`)
5. The extension icon (blue "U") appears in your toolbar — pin it for easy access

---

## First-Time Login

1. Click the extension icon
2. Enter your **server URL** (e.g., `http://localhost:3000` or your production URL)
3. Enter your **Umrah Logistics username and password**
4. Click **تسجيل الدخول وحفظ**
5. You're connected — the dot turns green ✅

Your login is saved. You won't need to log in again unless you manually disconnect.

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
├── popup.js              Logic: auth, capture, send
├── background.js         Service worker (context menu)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── SERVER_ENDPOINT.ts    Code to add to server.ts
└── README.md             This file
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "لا يمكن الاتصال بالخادم" | Check server URL and that `npm run dev` is running |
| "لم يتم استخراج أي رحلات" | The text doesn't match the expected Arabic format — check `parseItineraryText()` in parser.ts |
| "401 Unauthorized" | Token expired — click "تغيير" and log in again |
| Page capture gets nav/footer text | Use selection mode instead — select just the itinerary block |
| Extension not updating | Go to `chrome://extensions` and click the reload ↺ button |

---

## Permissions Explained

| Permission | Why |
|---|---|
| `activeTab` | Read the currently open tab to capture text |
| `scripting` | Inject the text-extraction function into the page |
| `storage` | Save your server URL and auth token locally |
| `host_permissions: <all_urls>` | Make API calls to your server (any URL) |
