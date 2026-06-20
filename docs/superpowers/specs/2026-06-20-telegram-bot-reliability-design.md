# Telegram Bot Reliability — Design Spec
**Date:** 2026-06-20  
**Status:** Approved

## Problem

The Telegram proximity alert bot stops sending notifications intermittently. The server (VPS) is always running, so the failure is in the code. Three root causes were identified:

1. **`notified_ids` race condition** — The server marks a trip as notified in the DB. The browser client also saves `notifiedIds` from React state on every state change (2-second debounce via `syncAllData`). The client's React state doesn't know what the server just marked, so the client sync overwrites and erases the server's marks. The server sees the trip as un-notified and re-sends. This cycle eventually results in apparent "stops then sends all at once" behavior.

2. **Dual notification system** — Both the browser (`checkAlerts` useEffect, every 30s) and the server (`checkAndSendAlerts`, every 60s) independently send Telegram messages, creating duplicate sends and conflicting ownership of `notified_ids`.

3. **Server ignores `alertSettings`** — The server hardcodes a 130-minute window and always includes all message fields. The user's configured `arrivalMinutes`, `departureMinutes`, and `messageFields` preferences are only respected when the browser is open. Additionally, the server never checks `data.ok` on the Telegram API response — it silently marks trips as notified even when the API call failed.

## Solution: Server is Sole Telegram Sender

The server handles all Telegram notifications 24/7. The browser handles only native browser popups (when tab is open). The server is the exclusive owner of `notified_ids`.

## Scope

5 changes across 3 files. No new dependencies, no schema changes.

---

## Change 1 — `server.ts`: Fix `checkAndSendAlerts` to use alertSettings

**Location:** `checkAndSendAlerts` function (~line 383)

After loading `settings`, read `alertSettings` from `extra_settings`:

```typescript
const extraSettings = settings.extra_settings ? JSON.parse(settings.extra_settings) : {};
const alertSettings = extraSettings.alertSettings ?? {
  arrivalMinutes: 120,
  departureMinutes: 60,
  messageFields: { flight: true, carType: true, count: false, tafweej: false },
};
```

For each row, determine trip direction and window:

```typescript
const isArrival = row.Column1?.includes('وصول');
const isDeparture = row.Column1?.includes('مغادرة');
const windowMinutes = isArrival
  ? alertSettings.arrivalMinutes
  : isDeparture
  ? alertSettings.departureMinutes
  : Math.max(alertSettings.arrivalMinutes, alertSettings.departureMinutes);

if (diffMinutes <= 0 || diffMinutes > windowMinutes) continue;
```

Build message respecting `messageFields`:

```typescript
const mf = alertSettings.messageFields;
const movementLabel = isArrival ? 'الوصول' : isDeparture ? 'المغادرة' : 'الحركة';
const flightStr = mf.flight && row.flight && row.flight !== '-'
  ? `✈️ <b>الرحلة:</b> <code>${escapeHTML(row.flight)}</code>\n` : '';
const carLine = mf.carType && row.carType ? `🚗 <b>نوع السيارة:</b> ${escapeHTML(row.carType)}\n` : '';
const countLine = mf.count && row.count ? `👥 <b>العدد:</b> ${escapeHTML(row.count)}\n` : '';
const tafweejLine = mf.tafweej && row.tafweej ? `📋 <b>التفويج:</b> ${escapeHTML(row.tafweej)}\n` : '';
const msg = `<b>🔔 تنبيه: ${movementLabel} قادم خلال ${windowMinutes} دقيقة</b>\n\n`
  + `📦 <b>المجموعة:</b> ${escapeHTML(row.groupName)}\n`
  + `🔢 <b>رقم م:</b> ${escapeHTML(row.groupNo)}\n`
  + flightStr
  + `🕒 <b>الوقت:</b> ${escapeHTML(row.time)}\n`
  + `📍 <b>من:</b> ${escapeHTML(row.from)}\n`
  + `📍 <b>إلى:</b> ${escapeHTML(row.to)}\n`
  + carLine + countLine + tafweejLine
  + `📊 <b>الحالة:</b> ${STATUS_LABELS[row.status] || row.status}`;
```

Fix Telegram response check — verify `data.ok` before marking as notified:

```typescript
const res = await fetch(`https://api.telegram.org/bot${tgConfig.token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: tgConfig.chatId, text: msg, parse_mode: 'HTML' }),
});
const data = await res.json();
if (!data.ok) {
  console.error(`[Alerts] Telegram API error for user ${userId}:`, data.description);
  continue; // Don't mark as notified if API rejected the message
}
```

Also update `GET /api/alerts/debug` to use the same `alertSettings`-based window instead of the hardcoded 130.

## Change 2 — `server.ts`: Server owns `notified_ids`, ignore client writes

**Location:** `POST /api/settings` handler (~line 176)

Change:
```typescript
notified_ids: notifiedIds !== undefined ? JSON.stringify(notifiedIds)
  : (existing?.notified_ids ?? null),
```

To:
```typescript
notified_ids: existing?.notified_ids ?? null,
```

The client still receives `notifiedIds` via `GET /api/settings` on login (to seed browser popup dedup), but can never overwrite what the server has marked. This eliminates the race condition entirely.

## Change 3 — `App.tsx`: Remove `sendTelegram` from browser `checkAlerts`

**Location:** `checkAlerts` useEffect (~line 323–343)

Remove the entire `if (tgConfigRef.current.enabled) { ... sendTelegram(msg); }` block. Keep only the native browser `new Notification(...)` block.

The `notifiedIdsRef.current.add(row.id)` and `setNotifiedIds(...)` lines stay — they still prevent duplicate browser popups within the same session.

## Change 4 — `App.tsx`: Remove dead `pollTelegram` loop

**Location:** `pollTelegram` useEffect (~line 268–293)

Remove the entire `useEffect` block (the `pollTelegram` async function + `setInterval`). Since the Gemini bot was removed, this loop polls Telegram every 5 seconds but does nothing with incoming messages. Dead code.

## Change 5 — `components/Settings.tsx`: Extend sliders to 24 hours

**Location:** Both `<input type="range">` sliders for `arrivalMinutes` and `departureMinutes` (~lines 219–237)

- Change `max={300}` → `max={1440}` on both sliders
- Change `step={5}` → `step={15}` (96 positions across 24 hours — fine enough control)
- Change the value display from `"{value} د"` to a smart format: show `"Xس Yد"` when ≥ 60, show `"X د"` when < 60

Helper (inline, no import needed):
```typescript
const fmtMin = (m: number) =>
  m < 60 ? `${m} د` : m % 60 === 0 ? `${m / 60} س` : `${Math.floor(m / 60)}س ${m % 60}د`;
```

---

## What Does NOT Change

- `GET /api/settings` — still returns `notifiedIds` for browser popup dedup seed
- Native browser notification logic in `checkAlerts` — unchanged
- `sendTelegram` function — stays (used by `handleTestTelegram` / test send button)
- `tgConfig`, `alertSettings` client state and sync — unchanged
- DB schema — no migrations needed
- The `/api/alerts/trigger` manual trigger endpoint — stays

## Success Criteria

1. Telegram alerts fire from the server even with browser closed
2. No duplicate Telegram messages when browser is also open
3. `arrivalMinutes` and `departureMinutes` from Settings are respected by the server worker
4. Only the fields checked in "حقول رسالة التيليجرام" appear in the Telegram message
5. The slider in Settings goes up to 24 hours (1440 min), displaying `"2س 30د"` format
6. A failed Telegram API call (non-ok response) does not mark the trip as notified
