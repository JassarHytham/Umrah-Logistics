# Telegram Bot Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram proximity alert bot send reliably 24/7 from the server, eliminating duplicate sends, the `notified_ids` race condition, and alertSettings being ignored.

**Architecture:** The Express server (`server.ts`) becomes the sole Telegram sender. Browser (`App.tsx`) handles only native browser popups. The `notified_ids` DB column is server-owned — the `POST /api/settings` handler stops accepting client overwrites for that field.

**Tech Stack:** Express, better-sqlite3, Vitest + supertest, React 19, Tailwind CSS

## Global Constraints

- No new npm dependencies
- No DB schema changes (use existing `notified_ids` and `extra_settings` columns)
- All Arabic copy must remain unchanged
- Run `npm run lint` (TypeScript tsc --noEmit) after every task — zero new errors allowed
- Run `npx vitest run` after every task — all existing tests must pass (except tests explicitly updated in the task)

---

## File Map

| File | Role |
|------|------|
| `server.ts` | Task 1 (settings race fix) + Task 3 (worker + debug fix) |
| `tests/server.test.ts` | Task 1 (update + add tests) |
| `App.tsx` | Task 2 (remove browser Telegram sends + dead pollTelegram) |
| `components/Settings.tsx` | Task 4 (slider max + display format) |

---

## Task 1: Fix `notified_ids` race condition in `server.ts`

**Files:**
- Modify: `server.ts` (POST /api/settings handler, ~line 176)
- Modify: `tests/server.test.ts` (update 1 test, add 1 test)

**What this fixes:** The client's `syncAllData` saves React `notifiedIds` state to the server every 2 seconds. When the server's alert worker marks a trip as notified, the client's next sync erases it (the client's state doesn't know what the server marked). This causes the server to re-send the same notification in a loop. Removing the client-write path makes `notified_ids` server-owned.

- [ ] **Step 1: Update the existing `notifiedIds` roundtrip test**

Open `tests/server.test.ts`. Find the test at line ~344 that asserts `notifiedIds` round-trips from client:

```typescript
expect(res.body.notifiedIds).toEqual(['id1', 'id2']);
```

The `notifiedIds` the client sends are no longer persisted — only the server alert worker writes `notified_ids`. Update this test to verify the field comes back empty (server-fresh user has no notified IDs):

Replace:
```typescript
expect(res.body.notifiedIds).toEqual(['id1', 'id2']);
```
With:
```typescript
expect(res.body.notifiedIds).toEqual([]); // server-managed; client writes are ignored
```

- [ ] **Step 2: Add a new test — client cannot overwrite server-marked notifiedIds**

In `tests/server.test.ts`, add a new `it` block inside the `describe('POST /api/settings', ...)` block, after the last existing test in that block:

```typescript
it('client notifiedIds do not overwrite server-managed notified_ids', async () => {
  // Simulate the server alert worker writing notified_ids directly to the DB.
  // We test via the settings API: save with server-side notifiedIds via a
  // direct DB manipulation. Since we can't call the worker from tests,
  // we verify the inverse: client-sent notifiedIds are silently dropped,
  // and the field comes back as whatever the server set (empty for new user).
  await authPost('/api/settings').send({ ...sampleSettings, notifiedIds: ['server-managed-id'] });
  const res = await authGet('/api/settings');
  // notifiedIds from the client payload must be ignored — server starts fresh for this test user
  expect(res.body.notifiedIds).toEqual([]);
});
```

- [ ] **Step 3: Run tests to confirm the new expectation currently fails**

```bash
npx vitest run tests/server.test.ts 2>&1 | grep -E "FAIL|PASS|notifiedIds"
```

Expected: the updated test at Step 1 and the new test at Step 2 should FAIL (they assert the new behavior which doesn't exist yet).

- [ ] **Step 4: Change `POST /api/settings` to ignore client `notifiedIds`**

Open `server.ts`. Find the `POST /api/settings` handler. Locate this line (~line 176):

```typescript
notified_ids: notifiedIds !== undefined ? JSON.stringify(notifiedIds)
  : (existing?.notified_ids ?? null),
```

Replace it with:

```typescript
notified_ids: existing?.notified_ids ?? null,
```

The `notifiedIds` variable from `req.body` is no longer used for persistence. The DB column is now exclusively written by the alert worker.

- [ ] **Step 5: Run tests — both updated tests must pass, no regressions**

```bash
npx vitest run tests/server.test.ts 2>&1 | tail -20
```

Expected output: all tests PASS.

- [ ] **Step 6: TypeScript check**

```bash
npm run lint 2>&1 | grep -v "chrome extention" | grep -E "error|warning" | head -20
```

Expected: zero new errors (some pre-existing chrome extension errors are acceptable baseline).

- [ ] **Step 7: Commit**

```bash
git add server.ts tests/server.test.ts
git commit -m "fix(alerts): server owns notified_ids — client writes silently dropped"
```

---

## Task 2: Remove browser Telegram sends and dead `pollTelegram` from `App.tsx`

**Files:**
- Modify: `App.tsx` (two useEffect blocks)

**What this fixes:** The browser's `checkAlerts` useEffect was also calling `sendTelegram()`, creating duplicate sends when the browser is open. The `pollTelegram` useEffect polls Telegram for incoming messages every 5 seconds but does nothing with them (the Gemini bot was removed). Both are removed.

- [ ] **Step 1: Remove the `sendTelegram` block from `checkAlerts`**

Open `App.tsx`. Find the `checkAlerts` useEffect (starts around line 298). Inside it, locate the Telegram send block that looks like this:

```typescript
if (tgConfigRef.current.enabled) {
  const mf = alertSettingsRef.current.messageFields;
  const movementLabel = isArrival ? 'الوصول' : isDeparture ? 'المغادرة' : 'الحركة';
  const flightLine = mf.flight && row.flight && row.flight !== '-' ? `✈️ <b>الرحلة:</b> <code>${escapeHTML(row.flight)}</code>\n` : '';
  const carLine = mf.carType && row.carType ? `🚗 <b>السيارة:</b> ${escapeHTML(row.carType)}\n` : '';
  const countLine = mf.count && row.count ? `👥 <b>العدد:</b> ${escapeHTML(row.count)}\n` : '';
  const tafweejLine = mf.tafweej && row.tafweej ? `📋 <b>التفويج:</b> ${escapeHTML(row.tafweej)}\n` : '';
  const msg = `<b>🔔 تنبيه: ${movementLabel} قادم خلال ${windowMinutes} دقيقة</b>\n\n📦 <b>المجموعة:</b> ${escapeHTML(row.groupName)}\n🔢 <b>رقم م:</b> ${escapeHTML(row.groupNo)}\n${flightLine}🕒 <b>الوقت:</b> ${escapeHTML(row.time)}\n📍 <b>من:</b> ${escapeHTML(row.from)}\n📍 <b>إلى:</b> ${escapeHTML(row.to)}\n${carLine}${countLine}${tafweejLine}📊 <b>الحالة:</b> ${STATUS_LABELS[row.status as TripStatus] || row.status}`;
  sendTelegram(msg);
}
```

Delete this entire `if (tgConfigRef.current.enabled) { ... }` block. Keep everything else in `checkAlerts` (the native `new Notification(...)` block and the `notifiedIdsRef.current.add(row.id)` + `setNotifiedIds(...)` lines stay).

- [ ] **Step 2: Remove the dead `pollTelegram` useEffect**

In `App.tsx`, find the useEffect that sets up the `pollTelegram` interval. It looks like:

```typescript
// --- Telegram Listener (Polling) ---
useEffect(() => {
  if (!tgConfig.enabled) return;

  const pollTelegram = async () => {
    const { token, enabled } = tgConfigRef.current;
    if (!enabled || !token) return;
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${tgLastUpdateId.current + 1}&timeout=10`);
      const data = await response.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          tgLastUpdateId.current = update.update_id;

        }
      }
    } catch (e) {
      console.error("Telegram Polling Error:", e);
    } finally {
      isPollingRef.current = false;
    }
  };

  const interval = setInterval(pollTelegram, 5000);
  return () => clearInterval(interval);
}, [tgConfig.enabled]);
```

Delete this entire `useEffect` block including the comment line above it.

- [ ] **Step 3: Check if `isPollingRef` is used anywhere else**

```bash
grep -n "isPollingRef\|tgLastUpdateId" /Users/jassar/Projects/Umrah/Umrah-Logistics/App.tsx
```

If `isPollingRef` and `tgLastUpdateId` only appear in the now-deleted block, also remove their `useRef` declarations. They look like:

```typescript
const tgLastUpdateId = useRef<number>(0);
const isPollingRef = useRef<boolean>(false);
```

Delete both lines.

- [ ] **Step 4: TypeScript check**

```bash
npm run lint 2>&1 | grep -v "chrome extention" | grep -E "error|warning" | head -20
```

Expected: zero new errors.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "fix(alerts): remove browser Telegram sends and dead pollTelegram loop"
```

---

## Task 3: Fix server-side `checkAndSendAlerts` to respect `alertSettings`

**Files:**
- Modify: `server.ts` (`checkAndSendAlerts` function + `/api/alerts/debug` endpoint)

**What this fixes:** The server's alert worker ignores the user's `alertSettings` (hardcodes 130-minute window, always includes all fields). It also never checks Telegram's `data.ok` response — silently marking trips as notified even when the API call failed. The debug endpoint also uses the hardcoded 130 for `wouldSend`.

- [ ] **Step 1: Replace `checkAndSendAlerts` body with alertSettings-aware version**

Open `server.ts`. Find the `checkAndSendAlerts` function (around line 383). Replace its entire body with the following:

```typescript
async function checkAndSendAlerts() {
  try {
    const users = db.prepare("SELECT id FROM users").all() as { id: number }[];
    const now = new Date();

    for (const { id: userId } of users) {
      const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId);
      if (!settings) continue;

      const tgConfig = settings.tg_config ? JSON.parse(settings.tg_config) : null;
      if (!tgConfig?.enabled || !tgConfig.token || !tgConfig.chatId) continue;

      const extraSettings = settings.extra_settings ? JSON.parse(settings.extra_settings) : {};
      const alertSettings = extraSettings.alertSettings ?? {
        arrivalMinutes: 120,
        departureMinutes: 60,
        messageFields: { flight: true, carType: true, count: false, tafweej: false },
      };

      const notifiedSet = new Set<string>(
        settings.notified_ids ? JSON.parse(settings.notified_ids) : []
      );

      const rows = db
        .prepare("SELECT data FROM logistics_rows WHERE user_id = ?")
        .all(userId) as { data: string }[];

      let changed = false;

      for (const { data } of rows) {
        const row = JSON.parse(data);
        if (!row.date || !row.time || notifiedSet.has(row.id)) continue;

        const tripDate = parseDateTime(row.date, row.time);
        if (!tripDate) continue;

        const diffMinutes = (tripDate.getTime() - now.getTime()) / (1000 * 60);

        const isArrival = row.Column1?.includes('وصول');
        const isDeparture = row.Column1?.includes('مغادرة');
        const windowMinutes = isArrival
          ? alertSettings.arrivalMinutes
          : isDeparture
          ? alertSettings.departureMinutes
          : Math.max(alertSettings.arrivalMinutes, alertSettings.departureMinutes);

        if (diffMinutes <= 0 || diffMinutes > windowMinutes) continue;

        const mf = alertSettings.messageFields;
        const movementLabel = isArrival ? 'الوصول' : isDeparture ? 'المغادرة' : 'الحركة';
        const flightStr = mf.flight && row.flight && row.flight !== '-'
          ? `✈️ <b>الرحلة:</b> <code>${escapeHTML(row.flight)}</code>\n` : '';
        const carLine = mf.carType && row.carType
          ? `🚗 <b>نوع السيارة:</b> ${escapeHTML(row.carType)}\n` : '';
        const countLine = mf.count && row.count
          ? `👥 <b>العدد:</b> ${escapeHTML(row.count)}\n` : '';
        const tafweejLine = mf.tafweej && row.tafweej
          ? `📋 <b>التفويج:</b> ${escapeHTML(row.tafweej)}\n` : '';
        const msg =
          `<b>🔔 تنبيه: ${movementLabel} قادم خلال ${windowMinutes} دقيقة</b>\n\n` +
          `📦 <b>المجموعة:</b> ${escapeHTML(row.groupName)}\n` +
          `🔢 <b>رقم م:</b> ${escapeHTML(row.groupNo)}\n` +
          flightStr +
          `🕒 <b>الوقت:</b> ${escapeHTML(row.time)}\n` +
          `📍 <b>من:</b> ${escapeHTML(row.from)}\n` +
          `📍 <b>إلى:</b> ${escapeHTML(row.to)}\n` +
          carLine + countLine + tafweejLine +
          `📊 <b>الحالة:</b> ${STATUS_LABELS[row.status] || row.status}`;

        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${tgConfig.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tgConfig.chatId, text: msg, parse_mode: 'HTML' }),
          });
          const tgData = await tgRes.json();
          if (!tgData.ok) {
            console.error(`[Alerts] Telegram API error for user ${userId}: ${tgData.description}`);
            continue; // Don't mark as notified — will retry next cycle
          }
          console.log(`[Alerts] Sent notification for trip ${row.id} (user ${userId})`);
        } catch (fetchErr) {
          console.error(`[Alerts] Telegram send failed for user ${userId}:`, fetchErr);
          continue;
        }

        notifiedSet.add(row.id);
        changed = true;
      }

      if (changed) {
        db.prepare(`
          INSERT INTO settings (user_id, notified_ids)
          VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET notified_ids = excluded.notified_ids
        `).run(userId, JSON.stringify(Array.from(notifiedSet)));
      }
    }
  } catch (err) {
    console.error('[Alerts] Worker error:', err);
  }
}
```

- [ ] **Step 2: Fix `GET /api/alerts/debug` to use alertSettings window**

Find the `/api/alerts/debug` handler (around line 214). After the line:

```typescript
const tgConfig = settings?.tg_config ? JSON.parse(settings.tg_config) : null;
```

Add:

```typescript
const extraSettings = settings?.extra_settings ? JSON.parse(settings.extra_settings) : {};
const alertSettings = extraSettings.alertSettings ?? {
  arrivalMinutes: 120,
  departureMinutes: 60,
  messageFields: { flight: true, carType: true, count: false, tafweej: false },
};
```

Then in the `tripDiagnostics` map, replace the hardcoded `130` in `wouldSend` and `skipReason`. Find:

```typescript
const wouldSend = !alreadyNotified && diffMinutes !== null && diffMinutes > 0 && diffMinutes <= 130;
```

Replace with:

```typescript
const isArrival = row.Column1?.includes('وصول');
const isDeparture = row.Column1?.includes('مغادرة');
const windowMinutes = isArrival
  ? alertSettings.arrivalMinutes
  : isDeparture
  ? alertSettings.departureMinutes
  : Math.max(alertSettings.arrivalMinutes, alertSettings.departureMinutes);
const wouldSend = !alreadyNotified && diffMinutes !== null && diffMinutes > 0 && diffMinutes <= windowMinutes;
```

Also update the skip reason string that references the old hardcoded window. Find:

```typescript
: diffMinutes !== null && diffMinutes > 130
  ? `too far away (${diffMinutes.toFixed(0)} min from now)`
```

Replace with:

```typescript
: diffMinutes !== null && diffMinutes > windowMinutes
  ? `too far away (${diffMinutes.toFixed(0)} min from now, window is ${windowMinutes} min)`
```

And add `windowMinutes` to the response object so it's visible in debug output. Find the `res.json({` call in the debug handler and add to the returned object:

```typescript
alertWindowMinutes: { arrival: alertSettings.arrivalMinutes, departure: alertSettings.departureMinutes },
```

- [ ] **Step 3: TypeScript check**

```bash
npm run lint 2>&1 | grep -v "chrome extention" | grep -E "error|warning" | head -20
```

Expected: zero new errors.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "fix(alerts): use alertSettings in server worker — respect window, messageFields, check Telegram ok"
```

---

## Task 4: Extend alert sliders to 24 hours in `Settings.tsx`

**Files:**
- Modify: `components/Settings.tsx`

**What this changes:** Both sliders go from `max={300}` (5h) to `max={1440}` (24h). Step changes from 5 to 15 minutes (96 positions). The value label shows hours+minutes when ≥ 60 minutes (e.g. `"2س 30د"`) instead of always showing minutes.

- [ ] **Step 1: Add the `fmtMin` helper at the top of the component**

Open `components/Settings.tsx`. Find the component body (the `export function Settings(...)` function or similar). Add this one-liner near the top of the component, before the first `return`:

```typescript
const fmtMin = (m: number) =>
  m < 60 ? `${m} د` : m % 60 === 0 ? `${Math.floor(m / 60)} س` : `${Math.floor(m / 60)}س ${m % 60}د`;
```

- [ ] **Step 2: Update the arrival slider**

Find:

```tsx
type="range" min={10} max={300} step={5}
value={alertSettings.arrivalMinutes}
onChange={(e) => onAlertSettingsChange({ ...alertSettings, arrivalMinutes: Number(e.target.value) })}
className="flex-1 accent-blue-600"
```

Replace `max={300} step={5}` with `max={1440} step={15}`:

```tsx
type="range" min={10} max={1440} step={15}
value={alertSettings.arrivalMinutes}
onChange={(e) => onAlertSettingsChange({ ...alertSettings, arrivalMinutes: Number(e.target.value) })}
className="flex-1 accent-blue-600"
```

Then find the value display span for arrival:

```tsx
<span className="text-xl font-black text-blue-700 w-16 text-center">{alertSettings.arrivalMinutes}<span className="text-xs font-bold"> د</span></span>
```

Replace with:

```tsx
<span className="text-xl font-black text-blue-700 w-20 text-center">{fmtMin(alertSettings.arrivalMinutes)}</span>
```

- [ ] **Step 3: Update the departure slider**

Find:

```tsx
type="range" min={10} max={300} step={5}
value={alertSettings.departureMinutes}
onChange={(e) => onAlertSettingsChange({ ...alertSettings, departureMinutes: Number(e.target.value) })}
className="flex-1 accent-indigo-600"
```

Replace `max={300} step={5}` with `max={1440} step={15}`:

```tsx
type="range" min={10} max={1440} step={15}
value={alertSettings.departureMinutes}
onChange={(e) => onAlertSettingsChange({ ...alertSettings, departureMinutes: Number(e.target.value) })}
className="flex-1 accent-indigo-600"
```

Then find the value display span for departure:

```tsx
<span className="text-xl font-black text-indigo-700 w-16 text-center">{alertSettings.departureMinutes}<span className="text-xs font-bold"> د</span></span>
```

Replace with:

```tsx
<span className="text-xl font-black text-indigo-700 w-20 text-center">{fmtMin(alertSettings.departureMinutes)}</span>
```

- [ ] **Step 4: TypeScript check**

```bash
npm run lint 2>&1 | grep -v "chrome extention" | grep -E "error|warning" | head -20
```

Expected: zero new errors.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add components/Settings.tsx
git commit -m "feat(settings): extend alert sliders to 24h, show hours+minutes format"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Server is sole Telegram sender | Task 2 (remove browser sends) |
| `notified_ids` race condition fixed | Task 1 (server ignores client writes) |
| Server respects `arrivalMinutes`/`departureMinutes` | Task 3 |
| Server respects `messageFields` | Task 3 |
| Telegram `data.ok` check | Task 3 |
| `pollTelegram` dead loop removed | Task 2 |
| Sliders extended to 1440 min (24h) | Task 4 |
| Hours+minutes display format | Task 4 |
| Debug endpoint uses real window | Task 3 |

All 9 spec requirements covered. ✓

**Placeholder scan:** No TBD/TODO/similar-to markers present. All code steps include complete implementations. ✓

**Type consistency:** `alertSettings.arrivalMinutes`, `alertSettings.departureMinutes`, `alertSettings.messageFields.flight/carType/count/tafweej` — used consistently across Task 3 server code matching the existing client-side type `AlertSettings` in `types.ts`. `fmtMin` defined in Task 4 Step 1 and used in Steps 2 and 3. ✓
