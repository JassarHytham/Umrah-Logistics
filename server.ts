import express from "express";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "umrah-secret-key-2026";

// Database initialization
const db = new Database("umrah.db");
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
    if (err.code === "SQLITE_CONSTRAINT") {
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
  
  const stmt = db.prepare(`
    INSERT INTO settings (user_id, tg_config, templates, deleted_rows, notified_ids, font_size)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tg_config = excluded.tg_config,
      templates = excluded.templates,
      deleted_rows = excluded.deleted_rows,
      notified_ids = excluded.notified_ids,
      font_size = excluded.font_size
  `);

  stmt.run(
    req.user.id,
    tgConfig ? JSON.stringify(tgConfig) : null,
    templates ? JSON.stringify(templates) : null,
    deletedRows ? JSON.stringify(deletedRows) : null,
    notifiedIds ? JSON.stringify(notifiedIds) : null,
    fontSize || 100
  );

  res.json({ success: true });
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
