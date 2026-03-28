import express from "express";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { parseDateTime } from "./utils/parser.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "umrah-secret-key-2026";

// Database initialization
const DB_PATH = process.env.VITEST ? ":memory:" : "umrah.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logistics_rows (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    tg_config TEXT,
    templates TEXT,
    deleted_rows TEXT,
    notified_ids TEXT,
    font_size INTEGER DEFAULT 100,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

// Migration: Add notified_ids if missing
try {
  db.prepare("SELECT notified_ids FROM settings LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE settings ADD COLUMN notified_ids TEXT");
  } catch (err) {
    console.error("Migration failed", err);
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware to verify JWT
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  });
};

// Auth Routes
app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    const info = stmt.run(username, hashedPassword);

    const userId = Number(info.lastInsertRowid);
    const token = jwt.sign({ id: userId, username }, JWT_SECRET);
    res.json({ token, user: { id: userId, username } });
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      res.status(400).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ id: Number(user.id), username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: Number(user.id), username: user.username } });
});

// Data Routes
app.get("/api/data", authenticateToken, (req: any, res) => {
  const rows = db.prepare("SELECT data FROM logistics_rows WHERE user_id = ?").all(req.user.id);
  res.json(rows.map((r: any) => JSON.parse(r.data)));
});

app.post("/api/data/sync", authenticateToken, (req: any, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Invalid data" });

  const deleteStmt = db.prepare("DELETE FROM logistics_rows WHERE user_id = ?");
  const insertStmt = db.prepare("INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)");

  const sync = db.transaction((rows) => {
    deleteStmt.run(req.user.id);
    for (const row of rows) {
      insertStmt.run(row.id, req.user.id, JSON.stringify(row));
    }
  });

  sync(rows);
  res.json({ success: true });
});

// Settings Routes
app.get("/api/settings", authenticateToken, (req: any, res) => {
  const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);
  if (!settings) return res.json({ tgConfig: null, templates: [], fontSize: 100 });

  res.json({
    tgConfig: settings.tg_config ? JSON.parse(settings.tg_config) : null,
    templates: settings.templates ? JSON.parse(settings.templates) : [],
    deletedRows: settings.deleted_rows ? JSON.parse(settings.deleted_rows) : [],
    notifiedIds: settings.notified_ids ? JSON.parse(settings.notified_ids) : [],
    fontSize: settings.font_size || 100
  });
});

app.post("/api/settings", authenticateToken, (req: any, res) => {
  const { tgConfig, templates, deletedRows, notifiedIds, fontSize } = req.body;

  // Merge with existing settings so partial saves never wipe unrelated fields
  const existing: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);

  const merged = {
    tg_config: tgConfig !== undefined ? (tgConfig ? JSON.stringify(tgConfig) : null)
      : (existing?.tg_config ?? null),
    templates: templates !== undefined ? (templates ? JSON.stringify(templates) : null)
      : (existing?.templates ?? null),
    deleted_rows: deletedRows !== undefined ? (deletedRows ? JSON.stringify(deletedRows) : null)
      : (existing?.deleted_rows ?? null),
    notified_ids: notifiedIds !== undefined ? JSON.stringify(notifiedIds)
      : (existing?.notified_ids ?? null),
    font_size: fontSize !== undefined ? fontSize : (existing?.font_size ?? 100),
  };

  db.prepare(`
    INSERT INTO settings (user_id, tg_config, templates, deleted_rows, notified_ids, font_size)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tg_config    = excluded.tg_config,
      templates    = excluded.templates,
      deleted_rows = excluded.deleted_rows,
      notified_ids = excluded.notified_ids,
      font_size    = excluded.font_size
  `).run(
    req.user.id,
    merged.tg_config,
    merged.templates,
    merged.deleted_rows,
    merged.notified_ids,
    merged.font_size
  );

  res.json({ success: true });
});

// Debug endpoint — shows what the alert worker sees for the logged-in user
app.get("/api/alerts/debug", authenticateToken, (req: any, res) => {
  const now = new Date();
  const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);

  const tgConfig = settings?.tg_config ? JSON.parse(settings.tg_config) : null;
  const notifiedIds: string[] = settings?.notified_ids ? JSON.parse(settings.notified_ids) : [];
  const notifiedSet = new Set(notifiedIds);

  const rawRows = db
    .prepare("SELECT data FROM logistics_rows WHERE user_id = ?")
    .all(req.user.id) as { data: string }[];

  const tripDiagnostics = rawRows.map(({ data }) => {
    const row = JSON.parse(data);
    const tripDate = parseDateTime(row.date, row.time);
    const diffMinutes = tripDate ? (tripDate.getTime() - now.getTime()) / (1000 * 60) : null;
    const alreadyNotified = notifiedSet.has(row.id);
    const wouldSend = !alreadyNotified && diffMinutes !== null && diffMinutes > 0 && diffMinutes <= 130;
    const skipReason = alreadyNotified
      ? 'already notified'
      : !row.date || !row.time
        ? 'missing date/time'
        : !tripDate
          ? 'date failed to parse'
          : diffMinutes !== null && diffMinutes <= 0
            ? `trip is in the past (${Math.abs(diffMinutes!).toFixed(0)} min ago)`
            : diffMinutes !== null && diffMinutes > 130
              ? `too far away (${diffMinutes.toFixed(0)} min from now)`
              : null;

    return {
      id: row.id,
      group: row.groupName,
      date: row.date,
      time: row.time,
      from: row.from,
      to: row.to,
      status: row.status,
      tripDateParsed: tripDate?.toISOString() ?? null,
      diffMinutes: diffMinutes !== null ? Math.round(diffMinutes) : null,
      alreadyNotified,
      wouldSend,
      skipReason,
    };
  });

  res.json({
    serverTime: now.toISOString(),
    telegramEnabled: tgConfig?.enabled ?? false,
    telegramConfigured: !!(tgConfig?.token && tgConfig?.chatId),
    notifiedIdsCount: notifiedIds.length,
    totalTrips: rawRows.length,
    tripsToSend: tripDiagnostics.filter(t => t.wouldSend).length,
    trips: tripDiagnostics,
  });
});

// Manually trigger the alert worker right now (for testing)
app.post("/api/alerts/trigger", authenticateToken, async (_req, res) => {
  await checkAndSendAlerts();
  res.json({ success: true, message: 'Alert check completed — see server logs' });
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production" && !process.env.VITEST) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else if (!process.env.VITEST) {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

// ─── Server-Side Telegram Alert Worker ───────────────────────────────────────
// Runs every 60 seconds regardless of browser state. Mirrors the browser-side
// checkAlerts() logic so notifications reach users 24/7.

const STATUS_LABELS: Record<string, string> = {
  'Planned': 'مخطط', 'Confirmed': 'مؤكد', 'Driver Assigned': 'تم تعيين السائق',
  'In Progress': 'قيد التنفيذ', 'Completed': 'مكتمل', 'Delayed': 'متأخر', 'Cancelled': 'ملغي',
};

const escapeHTML = (str: string) => {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] ?? m)
  );
};

async function checkAndSendAlerts() {
  try {
    const users = db.prepare("SELECT id FROM users").all() as { id: number }[];
    const now = new Date();

    for (const { id: userId } of users) {
      const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId);
      if (!settings) continue;

      const tgConfig = settings.tg_config ? JSON.parse(settings.tg_config) : null;
      if (!tgConfig?.enabled || !tgConfig.token || !tgConfig.chatId) continue;

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
        if (diffMinutes <= 0 || diffMinutes > 130) continue;

        const flightStr =
          row.flight && row.flight !== '-'
            ? `✈️ <b>الرحلة:</b> <code>${escapeHTML(row.flight)}</code>\n`
            : '';
        const msg =
          `<b>🔔 تنبيه: رحلة قادمة خلال ساعتين</b>\n\n` +
          `📦 <b>المجموعة:</b> ${escapeHTML(row.groupName)}\n` +
          `🔢 <b>رقم م:</b> ${escapeHTML(row.groupNo)}\n` +
          `${flightStr}` +
          `🕒 <b>الوقت:</b> ${escapeHTML(row.time)}\n` +
          `📍 <b>من:</b> ${escapeHTML(row.from)}\n` +
          `📍 <b>إلى:</b> ${escapeHTML(row.to)}\n` +
          `🚗 <b>نوع السيارة:</b> ${escapeHTML(row.carType)}\n` +
          `📊 <b>الحالة:</b> ${STATUS_LABELS[row.status] || row.status}`;

        try {
          await fetch(`https://api.telegram.org/bot${tgConfig.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tgConfig.chatId, text: msg, parse_mode: 'HTML' }),
          });
          console.log(`[Alerts] Sent notification for trip ${row.id} (user ${userId})`);
        } catch (fetchErr) {
          console.error(`[Alerts] Telegram send failed for user ${userId}:`, fetchErr);
          continue; // Don't mark as notified if send failed
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

export { app };

if (!process.env.VITEST) {
  // Start alert worker immediately then every 60 s
  checkAndSendAlerts();
  setInterval(checkAndSendAlerts, 60_000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`[Alerts] Proximity alert worker started (60 s interval)`);
  });
}
