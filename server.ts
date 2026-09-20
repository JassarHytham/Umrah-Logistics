import express from "express";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import helmet from "helmet";
import http from "http";
import { existsSync, readFileSync } from "node:fs";
import path from "path";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { parseDateTime, parseItineraryText } from "./utils/parser.js";
import { parseItineraryTextEN } from "./utils/parserEN.js";
import { detectCaptureLang } from "./utils/langDetect.js";
import { DEFAULT_ALERT_SETTINGS } from "./types.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = process.cwd();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || "umrah-logistics";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "umrah-logistics-web";
const JWT_REFRESH_AUDIENCE = `${JWT_AUDIENCE}-refresh`;
const LEGACY_INSECURE_JWT_SECRET = "umrah-secret-key-2026";

if (!JWT_SECRET || JWT_SECRET === LEGACY_INSECURE_JWT_SECRET) {
  if (isTestEnv) {
    process.env.JWT_SECRET = "vitest-only-secret-with-32-plus-characters";
  } else {
    throw new Error("JWT_SECRET must be set to a strong non-default value");
  }
}

const jwtSecret = process.env.JWT_SECRET as string;
const liveClients = new Map<number, Set<any>>();
type StoredTelegramConfig = {
  token?: string;
  chatId?: string;
  enabled?: boolean;
  botName?: string;
};

const getSettingsEncryptionKey = () => {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY || "";
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return key;
};

const encryptJson = (value: unknown) => {
  const key = getSettingsEncryptionKey();
  const plaintext = JSON.stringify(value);
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  if (!value.startsWith("enc:v1:")) return JSON.parse(value);
  const key = getSettingsEncryptionKey();
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is required to read encrypted settings");
  const [, , iv64, tag64, encrypted64] = value.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv64, "base64"));
  decipher.setAuthTag(Buffer.from(tag64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted64, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
};

const getExtensionInfo = () => {
  const zipPath = path.join(APP_ROOT, "public", "extensions", "umrah-extension.zip");
  const manifestPath = path.join(APP_ROOT, "chrome extention", "umrah-extension", "manifest.json");

  let version = "";
  try {
    version = JSON.parse(readFileSync(manifestPath, "utf8")).version || "";
  } catch {
    // Packaged deployments may ship without the extension source tree.
  }

  return {
    version,
    zipPath,
    zipUrl: "/api/download/extension",
    hasZip: existsSync(zipPath),
  };
};

// Database initialization
const DB_PATH = isTestEnv ? ":memory:" : (process.env.DB_PATH || "umrah.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    company_name TEXT,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logistics_rows (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    deleted_at DATETIME,
    deleted_by_user_id INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
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

  CREATE TABLE IF NOT EXISTS trip_share_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    scope_type TEXT NOT NULL,
    row_id TEXT,
    group_no TEXT,
    agency TEXT,
    role TEXT NOT NULL DEFAULT 'editor',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    FOREIGN KEY (sender_user_id) REFERENCES users (id),
    FOREIGN KEY (receiver_user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS trip_row_access (
    row_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    granted_by_user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (row_id, user_id),
    FOREIGN KEY (row_id) REFERENCES logistics_rows (id),
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (granted_by_user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS trip_group_access (
    group_no TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    granted_by_user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_no, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (granted_by_user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS trip_agency_access (
    agency TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    granted_by_user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agency, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (granted_by_user_id) REFERENCES users (id)
  );
`);

// Migration: Add shared recycle-bin columns if missing
try {
  db.prepare("SELECT deleted_at, deleted_by_user_id, version FROM logistics_rows LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE logistics_rows ADD COLUMN deleted_at DATETIME");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration deleted_at failed", err);
  }
  try {
    db.exec("ALTER TABLE logistics_rows ADD COLUMN deleted_by_user_id INTEGER");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration deleted_by_user_id failed", err);
  }
  try {
    db.exec("ALTER TABLE logistics_rows ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration version failed", err);
  }
}

// Migration: Add share roles if missing
try {
  db.prepare("SELECT role FROM trip_share_invitations LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE trip_share_invitations ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration invitation role failed", err);
  }
}
try {
  db.prepare("SELECT role FROM trip_row_access LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE trip_row_access ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration row access role failed", err);
  }
}
try {
  db.prepare("SELECT role FROM trip_group_access LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE trip_group_access ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration group access role failed", err);
  }
}
try {
  db.prepare("SELECT agency FROM trip_share_invitations LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE trip_share_invitations ADD COLUMN agency TEXT");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration invitation agency failed", err);
  }
}

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

// Migration: Add extra_settings if missing
try {
  db.prepare("SELECT extra_settings FROM settings LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE settings ADD COLUMN extra_settings TEXT");
  } catch (err) {
    console.error("Migration extra_settings failed", err);
  }
}

// Migration: Add company_name / avatar to users if missing
try {
  db.prepare("SELECT company_name, avatar FROM users LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE users ADD COLUMN company_name TEXT");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration company_name failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration avatar failed", err);
  }
}

// Migration: Add role / is_active / company_id / last_login_at to users if missing
try {
  db.prepare("SELECT role, is_active, company_id, last_login_at FROM users LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration role failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration is_active failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN company_id INTEGER");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration company_id failed", err);
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN last_login_at DATETIME");
  } catch (err: any) {
    if (!String(err.message || "").includes("duplicate column")) console.error("Migration last_login_at failed", err);
  }
}

// New tables: companies (admin-side grouping label only, never used by row-sharing
// access control) and audit_log (account/security events for the admin dashboard).
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor_user_id INTEGER,
    target_user_id INTEGER,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// audit_log started out covering only account/security events. It now covers
// activity system-wide (data, sharing, settings, integrations, errors), so it
// needs a severity (level) and a coarse bucket (category) for the admin
// panel to filter on. Follows the same try/catch ALTER TABLE pattern as the
// other migrations in this file.
try {
  db.exec("ALTER TABLE audit_log ADD COLUMN level TEXT NOT NULL DEFAULT 'info'");
} catch (err: any) {
  if (!String(err.message || "").includes("duplicate column")) console.error("Migration audit_log.level failed", err);
}
try {
  db.exec("ALTER TABLE audit_log ADD COLUMN category TEXT");
} catch (err: any) {
  if (!String(err.message || "").includes("duplicate column")) console.error("Migration audit_log.category failed", err);
}
db.exec(`
  UPDATE audit_log SET category = 'auth' WHERE category IS NULL AND event_type IN ('login_success', 'login_failure');
  UPDATE audit_log SET level = 'warning' WHERE event_type = 'login_failure';
  UPDATE audit_log SET category = 'user_mgmt' WHERE category IS NULL AND event_type LIKE 'user_%';
  UPDATE audit_log SET category = 'company_mgmt' WHERE category IS NULL AND event_type LIKE 'company_%';
`);

type AuditLevel = "info" | "warning" | "error";

function logEvent(eventType: string, opts: {
  level?: AuditLevel;
  category: string;
  actorUserId?: number | null;
  targetUserId?: number | null;
  metadata?: unknown;
}) {
  try {
    db.prepare(`
      INSERT INTO audit_log (event_type, level, category, actor_user_id, target_user_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      eventType,
      opts.level || "info",
      opts.category,
      opts.actorUserId ?? null,
      opts.targetUserId ?? null,
      opts.metadata !== undefined ? JSON.stringify(opts.metadata) : null,
    );
  } catch (err) {
    // Best-effort: a logging failure (SQLITE_BUSY, full disk, ...) must never
    // become a reason the action it's logging fails.
    console.error(`Failed to record ${eventType} audit event`, err);
  }
}

const AUDIT_LOG_RETENTION_DAYS = 90;

function pruneAuditLog() {
  try {
    db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', '-${AUDIT_LOG_RETENTION_DAYS} days')`).run();
  } catch (err) {
    console.error("Failed to prune audit_log", err);
  }
}

app.disable("x-powered-by");

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const isProductionLike = ["production", "staging"].includes(process.env.NODE_ENV || "");

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  // Vite's dev server injects an inline React-Refresh preamble script and
  // hot-reloaded <style> tags; production/staging builds need neither, so
  // only local dev gets the relaxed policy.
  scriptSrc: isProductionLike ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  styleSrc: isProductionLike ? ["'self'"] : ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:"],
  fontSrc: ["'self'"],
  connectSrc: ["'self'", "ws:", "wss:"],
  formAction: ["'self'"],
  upgradeInsecureRequests: null,
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  frameguard: { action: "deny" },
  hsts: isProductionLike ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: false,
  } : false,
  referrerPolicy: { policy: "no-referrer" },
}));

app.use("/api", cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  maxAge: 600,
}));

// req.ip is normally the client's socket address, but for malformed/aborted
// connections (e.g. raw internet scanners hitting the exposed port) it can
// come back undefined, which crashes express-rate-limit's default key
// generator (it hashes the key without checking for one). Fall back to the
// raw socket address, then a constant, instead of ever hashing undefined.
// ipKeyGenerator normalizes the result (in particular, it collapses an IPv6
// address to its /56 subnet) — express-rate-limit requires it for any custom
// keyGenerator that touches an IP, otherwise a single client can dodge the
// limit by cycling through addresses in its own IPv6 block.
const rateLimitKeyGenerator = (req: any): string =>
  ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: () => isTestEnv,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: rateLimitKeyGenerator,
  skip: () => isTestEnv,
});

const botLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: () => isTestEnv,
});

app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));
// Public, unauthenticated marketing pages, served at clean paths (no .html
// extension) so the URL doesn't expose the underlying file layout. Each path
// is hardcoded below — never built from request input — so there is no path
// traversal surface here.
const marketingPages: Record<string, string> = {
  "/home": "home.html",
  "/about": "about.html",
  "/contact": "contact.html",
  "/security": "security.html",
  "/terms": "terms.html",
  "/cookies": "cookies.html",
  "/privacy": "privacy.html",
};
for (const [route, file] of Object.entries(marketingPages)) {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", file));
  });
  // Redirect the old *.html URL (and any pre-existing bookmarks/links) to
  // the clean path so only one canonical URL is ever served.
  app.get(`/${file}`, (_req, res) => {
    res.redirect(301, route);
  });
}
app.get("/privacy.css", (_req, res) => {
  res.type("text/css");
  res.sendFile(path.join(__dirname, "public", "privacy.css"));
});

// Middleware to verify JWT
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ["HS256"],
  }, (err: any, user: any) => {
    if (err) {
      const status = err.name === "TokenExpiredError" ? 401 : 403;
      return res.status(status).json({ error: status === 401 ? "Unauthorized" : "Forbidden" });
    }
    // The JWT payload can outlive the account it points to (deleted/recreated
    // user, restored-from-backup database, etc), or the account's current
    // role/active state (admin demoted, user disabled). A signature check
    // alone lets a stale id or stale role through, where a stale id later
    // blows up as a raw FOREIGN KEY constraint failure on any write keyed by
    // user_id. Re-check both fresh from the DB on every request instead of
    // trusting the JWT payload, so disabling a user or demoting an admin
    // takes effect on their very next request, not after their token expires.
    const current = db.prepare("SELECT role, is_active FROM users WHERE id = ?").get(Number(user.id)) as
      | { role: string; is_active: number }
      | undefined;
    if (!current || !current.is_active) return res.status(401).json({ error: "Unauthorized" });
    req.user = { ...user, role: current.role };
    next();
  });
};

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
};

type LogisticsRowRecord = {
  id: string;
  user_id: number;
  data: string;
  version: number;
  updated_at?: string;
  deleted_at?: string | null;
  deleted_by_user_id?: number | null;
};

type ShareRole = "viewer" | "editor";
type AccessRole = ShareRole | "owner";
type AccessScope = "owner" | "row" | "group" | "agency";

const parseRowData = (data: string) => JSON.parse(data);

const sanitizeRowForStorage = (row: any) => {
  const { _sharing, _originalIndex, _version, ...stored } = row;
  return stored;
};

const normalizeShareRole = (role: any): ShareRole => role === "viewer" ? "viewer" : "editor";
const normalizeAgency = (agency: any) => String(agency || "").trim();
const normalizeUsername = (value: unknown) => String(value || "").trim().toLowerCase();
const isValidUsername = (value: string) => /^[a-z0-9_][a-z0-9_-]{2,31}$/.test(value);
const isValidPassword = (value: unknown) => typeof value === "string" && value.length >= 10 && value.length <= 128;
const MAX_AVATAR_LENGTH = 1_500_000; // ~1.1MB raw image, base64-encoded
const isValidAvatarDataUri = (value: unknown) =>
  typeof value === "string" &&
  value.length <= MAX_AVATAR_LENGTH &&
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value);
const asTrimmedString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validateRowsPayload = (rows: unknown) =>
  Array.isArray(rows) &&
  rows.length <= 5000 &&
  rows.every((row) => isPlainObject(row) && typeof row.id === "string" && row.id.length <= 128);

const canEditAccessRole = (role: AccessRole | null | undefined) => role === "owner" || role === "editor";

const getUsernameById = (id: number | null | undefined) => {
  if (!id) return null;
  const user: any = db.prepare("SELECT username FROM users WHERE id = ?").get(id);
  return user?.username ?? null;
};

const getUserByUsername = (username: string) =>
  db.prepare("SELECT id, username FROM users WHERE username = ?").get(username) as { id: number; username: string } | undefined;

const getRowAccessForUser = (userId: number, record: LogisticsRowRecord): { scope: AccessScope; role: AccessRole } | null => {
  if (Number(record.user_id) === Number(userId)) return { scope: "owner", role: "owner" };

  const accessCandidates: { scope: AccessScope; role: ShareRole }[] = [];

  const rowAccess = db
    .prepare("SELECT role FROM trip_row_access WHERE row_id = ? AND user_id = ?")
    .get(record.id, userId) as { role: ShareRole } | undefined;
  if (rowAccess) accessCandidates.push({ scope: "row", role: normalizeShareRole(rowAccess.role) });

  const row = parseRowData(record.data);
  if (row.groupNo) {
    const groupAccess = db
      .prepare("SELECT role FROM trip_group_access WHERE group_no = ? AND user_id = ?")
      .get(String(row.groupNo), userId) as { role: ShareRole } | undefined;
    if (groupAccess) accessCandidates.push({ scope: "group", role: normalizeShareRole(groupAccess.role) });
  }

  const agency = normalizeAgency(row.agency);
  if (agency) {
    const agencyAccess = db
      .prepare("SELECT role FROM trip_agency_access WHERE agency = ? AND user_id = ?")
      .get(agency, userId) as { role: ShareRole } | undefined;
    if (agencyAccess) accessCandidates.push({ scope: "agency", role: normalizeShareRole(agencyAccess.role) });
  }

  const editorAccess = accessCandidates.find((access) => access.role === "editor");
  if (editorAccess) return editorAccess;
  if (accessCandidates[0]) return accessCandidates[0];

  return null;
};

const getRowScopeForUser = (userId: number, record: LogisticsRowRecord): AccessScope | null =>
  getRowAccessForUser(userId, record)?.scope ?? null;

const getRowRecordById = (rowId: string) =>
  db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
    .get(rowId) as LogisticsRowRecord | undefined;

const getVisibleRowForUser = (userId: number, rowId: string, includeDeleted = false) => {
  const record = getRowRecordById(rowId);
  if (!record) return null;
  if (!includeDeleted && record.deleted_at) return null;
  return getRowScopeForUser(userId, record) ? record : null;
};

// Group numbers reach us from three places that disagree about type and padding:
// the extension always sends a trimmed string, the parser writes a trimmed string,
// but rows typed into the grid or imported from a spreadsheet can hold a number or
// a value with stray whitespace. Comparing those with === silently failed, which is
// why "overwrite" sometimes left the old rows in place and produced duplicates.
const sameGroupNo = (value: unknown, target: string) => String(value ?? "").trim() === target;

// `settings.deleted_rows` is the browser's mirror of the recycle bin. Purging rows
// used to blank it wholesale, which wiped trash entries that were never purged.
const removeRowsFromDeletedMirror = (userId: number, ids: Iterable<string>) => {
  const idSet = new Set(Array.from(ids));
  if (idSet.size === 0) return;
  const row = db.prepare("SELECT deleted_rows FROM settings WHERE user_id = ?").get(userId) as { deleted_rows: string | null } | undefined;
  if (!row?.deleted_rows) return;
  try {
    const stored = JSON.parse(row.deleted_rows);
    if (!Array.isArray(stored)) return;
    const kept = stored.filter((entry: any) => !idSet.has(entry?.id));
    if (kept.length === stored.length) return;
    db.prepare("UPDATE settings SET deleted_rows = ? WHERE user_id = ?").run(JSON.stringify(kept), userId);
  } catch {
    // A corrupt mirror is not worth failing the purge over — the client rebuilds it
    // from /api/data/deleted on the next load anyway.
  }
};

const decorateRowForUser = (
  record: LogisticsRowRecord,
  userId: number,
  precomputedAccess?: { scope: AccessScope; role: AccessRole } | null,
) => {
  const row = parseRowData(record.data);
  row._version = Number(record.version || 1);
  const access = precomputedAccess !== undefined ? precomputedAccess : getRowAccessForUser(userId, record);
  const scope = access?.scope;
  const isShared = Boolean(scope && scope !== "owner");
  if (isShared || record.deleted_at) {
    row._sharing = {
      shared: isShared,
      ownerUsername: getUsernameById(record.user_id),
      ...(scope && scope !== "owner" ? { scope, role: access?.role } : {}),
      ...(record.deleted_at ? { deletedAt: record.deleted_at, deletedByUsername: getUsernameById(record.deleted_by_user_id) } : {}),
    };
  }
  return row;
};

// getRowAccessForUser does up to 3 queries (row/group/agency share tables) plus a
// JSON.parse, per row it's called on. For a single row that's fine, but listing
// the whole table used to call it once per non-owned row here and again inside
// decorateRowForUser for every visible row — thousands of synchronous DB round
// trips on a large table. Batch-fetch this user's shares once (3 queries total,
// not 3 per row) and resolve each row's access from those in-memory maps instead.
const listVisibleRowsForUser = (userId: number, includeDeleted = false) => {
  const records = db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows")
    .all() as LogisticsRowRecord[];

  const rowRoles = new Map<string, ShareRole>(
    (db.prepare("SELECT row_id, role FROM trip_row_access WHERE user_id = ?").all(userId) as { row_id: string; role: string }[])
      .map((r) => [r.row_id, normalizeShareRole(r.role)]),
  );
  const groupRoles = new Map<string, ShareRole>(
    (db.prepare("SELECT group_no, role FROM trip_group_access WHERE user_id = ?").all(userId) as { group_no: string; role: string }[])
      .map((r) => [r.group_no, normalizeShareRole(r.role)]),
  );
  const agencyRoles = new Map<string, ShareRole>(
    (db.prepare("SELECT agency, role FROM trip_agency_access WHERE user_id = ?").all(userId) as { agency: string; role: string }[])
      .map((r) => [r.agency, normalizeShareRole(r.role)]),
  );

  const resolveAccess = (record: LogisticsRowRecord): { scope: AccessScope; role: AccessRole } | null => {
    if (Number(record.user_id) === Number(userId)) return { scope: "owner", role: "owner" };

    const candidates: { scope: AccessScope; role: ShareRole }[] = [];
    const rowRole = rowRoles.get(record.id);
    if (rowRole) candidates.push({ scope: "row", role: rowRole });

    const row = parseRowData(record.data);
    if (row.groupNo) {
      const groupRole = groupRoles.get(String(row.groupNo));
      if (groupRole) candidates.push({ scope: "group", role: groupRole });
    }
    const agency = normalizeAgency(row.agency);
    if (agency) {
      const agencyRole = agencyRoles.get(agency);
      if (agencyRole) candidates.push({ scope: "agency", role: agencyRole });
    }

    const editorAccess = candidates.find((access) => access.role === "editor");
    return editorAccess ?? candidates[0] ?? null;
  };

  return records
    .filter((record) => includeDeleted ? Boolean(record.deleted_at) : !record.deleted_at)
    .map((record) => ({ record, access: resolveAccess(record) }))
    .filter((entry): entry is { record: LogisticsRowRecord; access: { scope: AccessScope; role: AccessRole } } => Boolean(entry.access))
    .map(({ record, access }) => decorateRowForUser(record, userId, access));
};

type LiveEventType = "rows_changed" | "invitations_changed";

const sendLiveEvent = (userIds: Iterable<number>, type: LiveEventType, actorUserId?: number) => {
  const payload = JSON.stringify({ type, at: new Date().toISOString(), ...(actorUserId ? { actorUserId: Number(actorUserId) } : {}) });
  for (const id of new Set(Array.from(userIds).map(Number))) {
    const clients = liveClients.get(id);
    if (!clients) continue;
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }
};

const parseStoredJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const parseExtraSettings = (value: string | null | undefined) =>
  parseStoredJson<Record<string, any>>(value, {});

const getVisibleUserIdsForRowRecord = (record: LogisticsRowRecord) => {
  const userIds = new Set<number>([Number(record.user_id)]);
  const rowAccess = db.prepare("SELECT user_id FROM trip_row_access WHERE row_id = ?").all(record.id) as { user_id: number }[];
  rowAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));

  const row = parseRowData(record.data);
  if (row.groupNo) {
    const groupAccess = db.prepare("SELECT user_id FROM trip_group_access WHERE group_no = ?").all(String(row.groupNo)) as { user_id: number }[];
    groupAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));
  }

  const agency = normalizeAgency(row.agency);
  if (agency) {
    const agencyAccess = db.prepare("SELECT user_id FROM trip_agency_access WHERE agency = ?").all(agency) as { user_id: number }[];
    agencyAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));
  }
  return userIds;
};

const getVisibleUserIdsForRowId = (rowId: string) => {
  const record = db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
    .get(rowId) as LogisticsRowRecord | undefined;
  return record ? getVisibleUserIdsForRowRecord(record) : new Set<number>();
};

const getVisibleUserIdsForGroupNo = (groupNo: string, ownerUserId: number) => {
  const userIds = new Set<number>([Number(ownerUserId)]);
  const groupAccess = db.prepare("SELECT user_id FROM trip_group_access WHERE group_no = ?").all(groupNo) as { user_id: number }[];
  groupAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));
  return userIds;
};

const getVisibleUserIdsForAgency = (agency: string, ownerUserId: number) => {
  const userIds = new Set<number>([Number(ownerUserId)]);
  const agencyAccess = db.prepare("SELECT user_id FROM trip_agency_access WHERE agency = ?").all(normalizeAgency(agency)) as { user_id: number }[];
  agencyAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));
  return userIds;
};

const attachLiveUpdates = (server: http.Server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", "http://localhost");
    if (url.pathname !== "/api/live") return;

    const token = url.searchParams.get("token");
    if (!token) {
      socket.destroy();
      return;
    }

    try {
      const user = jwt.verify(token, jwtSecret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ["HS256"],
      }) as { id: number; username: string };

      // The JWT signature alone only proves the token was issued by us — it
      // says nothing about whether the account still exists or is still
      // active, unlike every HTTP route (see authenticateToken). Without this,
      // a disabled user's existing socket survives until token expiry and can
      // even open new ones.
      const current = db.prepare("SELECT role, is_active FROM users WHERE id = ?").get(Number(user.id)) as
        | { role: string; is_active: number }
        | undefined;
      if (!current || !current.is_active) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        (ws as any).userId = Number(user.id);
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: any) => {
    const userId = Number(ws.userId);
    const clients = liveClients.get(userId) ?? new Set();
    clients.add(ws);
    liveClients.set(userId, clients);
    ws.on("close", () => {
      const current = liveClients.get(userId);
      if (!current) return;
      current.delete(ws);
      if (current.size === 0) liveClients.delete(userId);
    });
  });

  return wss;
};

// Admin bootstrap: seed the single super-admin account on first boot. Does not
// crash the server if the env vars are absent — an existing deployment without
// them should still start; it just has no admin account yet.
try {
  const existingAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!existingAdmin) {
    const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME);
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (isValidUsername(adminUsername) && isValidPassword(adminPassword)) {
      const hashedPassword = bcrypt.hashSync(adminPassword as string, 10);
      db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run(adminUsername, hashedPassword);
      console.log(`Seeded admin account "${adminUsername}"`);
    } else {
      console.warn("No admin account exists yet, and ADMIN_USERNAME/ADMIN_PASSWORD are missing or invalid (username 3-32 lowercase letters/digits/_/-, password 10-128 chars) — set them in .env and restart to create one.");
    }
  }
} catch (err) {
  console.error("Admin bootstrap failed", err);
}

// Auth Routes
const signAuthToken = (user: { id: number; username: string }) =>
  jwt.sign(
    { id: Number(user.id), username: user.username },
    jwtSecret,
    {
      expiresIn: "8h",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: "HS256",
    },
  );

const signRefreshToken = (user: { id: number; username: string }) =>
  jwt.sign(
    { id: Number(user.id), username: user.username, type: "refresh" },
    jwtSecret,
    {
      expiresIn: "30d",
      issuer: JWT_ISSUER,
      audience: JWT_REFRESH_AUDIENCE,
      algorithm: "HS256",
    },
  );

const authResponse = (user: { id: number; username: string; company_name?: string | null; avatar?: string | null; role: string }) => ({
  token: signAuthToken(user),
  refreshToken: signRefreshToken(user),
  user: {
    id: Number(user.id),
    username: user.username,
    companyName: user.company_name ?? null,
    avatar: user.avatar ?? null,
    role: user.role || 'user',
  },
});

app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  if (!username || typeof password !== "string") return res.status(401).json({ error: "Invalid credentials" });
  const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password)) || !user.is_active) {
    logEvent("login_failure", { category: "auth", level: "warning", actorUserId: user ? user.id : null, metadata: { username } });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  try {
    db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  } catch (err) {
    console.error("Failed to update last_login_at", err);
  }
  logEvent("login_success", { category: "auth", actorUserId: user.id });

  res.json(authResponse(user));
});

app.post("/api/auth/refresh", (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  try {
    const payload = jwt.verify(refreshToken, jwtSecret, {
      issuer: JWT_ISSUER,
      audience: JWT_REFRESH_AUDIENCE,
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;

    if (payload.type !== "refresh" || !Number.isInteger(Number(payload.id))) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const user = db.prepare("SELECT id, username, company_name, avatar, role, is_active FROM users WHERE id = ?").get(Number(payload.id)) as
      | { id: number; username: string; company_name: string | null; avatar: string | null; role: string; is_active: number }
      | undefined;
    if (!user || !user.is_active) return res.status(401).json({ error: "Invalid refresh token" });

    return res.json(authResponse(user));
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

// Admin Routes
app.get("/api/admin/overview", authenticateToken, requireAdmin, (req, res) => {
  const totalUsers = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const activeUsers = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_active = 1").get() as { count: number }).count;
  const totalCompanies = (db.prepare("SELECT COUNT(*) AS count FROM companies").get() as { count: number }).count;
  const totalRows = (db.prepare("SELECT COUNT(*) AS count FROM logistics_rows WHERE deleted_at IS NULL").get() as { count: number }).count;
  res.json({ totalUsers, activeUsers, totalCompanies, totalRows });
});

app.get("/api/admin/audit", authenticateToken, requireAdmin, (req, res) => {
  const conditions: string[] = [];
  const params: string[] = [];
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const level = typeof req.query.level === "string" ? req.query.level : undefined;
  if (category) {
    conditions.push("a.category = ?");
    params.push(category);
  }
  if (level) {
    conditions.push("a.level = ?");
    params.push(level);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT
      a.id,
      a.event_type AS eventType,
      a.level,
      a.category,
      a.actor_user_id AS actorUserId,
      actor.username AS actorUsername,
      a.target_user_id AS targetUserId,
      target.username AS targetUsername,
      a.metadata,
      strftime('%Y-%m-%dT%H:%M:%SZ', a.created_at) AS createdAt
    FROM audit_log a
    LEFT JOIN users actor ON actor.id = a.actor_user_id
    LEFT JOIN users target ON target.id = a.target_user_id
    ${whereClause}
    ORDER BY a.id DESC
    LIMIT 200
  `).all(...params) as any[];

  res.json({
    events: rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })),
  });
});

app.get("/api/admin/users", authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.role,
      u.is_active AS isActive,
      u.company_id AS companyId,
      c.name AS companyName,
      strftime('%Y-%m-%dT%H:%M:%SZ', u.created_at) AS createdAt,
      strftime('%Y-%m-%dT%H:%M:%SZ', u.last_login_at) AS lastLoginAt
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    ORDER BY u.created_at DESC
  `).all() as any[];
  res.json({ users: rows.map((r) => ({ ...r, isActive: !!r.isActive })) });
});

app.post("/api/admin/users", authenticateToken, requireAdmin, async (req: any, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  const companyId = req.body?.companyId ?? null;

  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-32 lowercase letters, numbers, underscores, or hyphens" });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 10-128 characters" });
  if (companyId !== null) {
    const company = db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId);
    if (!company) return res.status(400).json({ error: "Company not found" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const info = db.prepare("INSERT INTO users (username, password, company_id) VALUES (?, ?, ?)").run(username, hashedPassword, companyId);
    const userId = Number(info.lastInsertRowid);

    logEvent("user_created", { category: "user_mgmt", actorUserId: req.user.id, targetUserId: userId });

    const created = db.prepare(`
      SELECT u.id, u.username, u.role, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName, strftime('%Y-%m-%dT%H:%M:%SZ', u.created_at) AS createdAt, strftime('%Y-%m-%dT%H:%M:%SZ', u.last_login_at) AS lastLoginAt
      FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?
    `).get(userId) as any;
    res.status(201).json({ user: { ...created, isActive: !!created.isActive } });
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      res.status(400).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

app.patch("/api/admin/users/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const userId = Number(req.params.id);
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "companyId")) {
    const companyId = req.body.companyId;
    if (companyId !== null) {
      const company = db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId);
      if (!company) return res.status(400).json({ error: "Company not found" });
    }
    db.prepare("UPDATE users SET company_id = ? WHERE id = ?").run(companyId, userId);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) {
    const isActive = req.body.isActive ? 1 : 0;
    if (userId === Number(req.user.id) && !req.body.isActive) {
      return res.status(400).json({ error: "Cannot disable your own account" });
    }
    db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(isActive, userId);
    logEvent(isActive ? "user_enabled" : "user_disabled", { category: "user_mgmt", actorUserId: req.user.id, targetUserId: userId });
  }

  const updated = db.prepare(`
    SELECT u.id, u.username, u.role, u.is_active AS isActive, u.company_id AS companyId, c.name AS companyName, strftime('%Y-%m-%dT%H:%M:%SZ', u.created_at) AS createdAt, strftime('%Y-%m-%dT%H:%M:%SZ', u.last_login_at) AS lastLoginAt
    FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?
  `).get(userId) as any;
  res.json({ user: { ...updated, isActive: !!updated.isActive } });
});

app.post("/api/admin/users/:id/reset-password", authenticateToken, requireAdmin, async (req: any, res) => {
  const userId = Number(req.params.id);
  const { password } = req.body;
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 10-128 characters" });

  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  const hashedPassword = await bcrypt.hash(password, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, userId);
  logEvent("user_password_reset", { category: "user_mgmt", actorUserId: req.user.id, targetUserId: userId });

  res.json({ success: true });
});

app.delete("/api/admin/users/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const userId = Number(req.params.id);
  if (userId === Number(req.user.id)) return res.status(400).json({ error: "Cannot delete your own account" });

  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "User not found" });

  const ownsRows = db.prepare("SELECT 1 FROM logistics_rows WHERE user_id = ? LIMIT 1").get(userId);
  if (ownsRows) return res.status(400).json({ error: "Cannot delete a user that still owns trip rows" });

  // The route above already refuses to delete a user who still owns any
  // logistics_rows, so it's always safe to clean up everything else keyed by
  // this user_id — otherwise these become orphaned cruft (including a stale
  // Telegram bot token sitting in `settings`).
  db.transaction(() => {
    db.prepare("DELETE FROM settings WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM trip_row_access WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM trip_group_access WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM trip_agency_access WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM trip_share_invitations WHERE sender_user_id = ? OR receiver_user_id = ?").run(userId, userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    logEvent("user_deleted", { category: "user_mgmt", actorUserId: req.user.id, targetUserId: userId });
  })();

  res.json({ success: true });
});

app.get("/api/admin/companies", authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at) AS createdAt, COUNT(u.id) AS userCount
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all();
  res.json({ companies: rows });
});

app.post("/api/admin/companies", authenticateToken, requireAdmin, (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Company name is required" });

  try {
    const info = db.prepare("INSERT INTO companies (name) VALUES (?)").run(name);
    const companyId = Number(info.lastInsertRowid);
    logEvent("company_created", { category: "company_mgmt", actorUserId: req.user.id, metadata: { companyId, name } });
    res.status(201).json({ company: { id: companyId, name, userCount: 0, createdAt: new Date().toISOString() } });
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      res.status(400).json({ error: "A company with that name already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

app.patch("/api/admin/companies/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const companyId = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Company name is required" });

  const existing = db.prepare("SELECT id FROM companies WHERE id = ?").get(companyId);
  if (!existing) return res.status(404).json({ error: "Company not found" });

  try {
    db.prepare("UPDATE companies SET name = ? WHERE id = ?").run(name, companyId);
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      return res.status(400).json({ error: "A company with that name already exists" });
    }
    return res.status(500).json({ error: "Server error" });
  }

  logEvent("company_renamed", { category: "company_mgmt", actorUserId: req.user.id, metadata: { companyId, name } });

  const userCount = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ?").get(companyId) as { count: number }).count;
  const createdAt = (db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS createdAt FROM companies WHERE id = ?").get(companyId) as { createdAt: string }).createdAt;
  res.json({ company: { id: companyId, name, userCount, createdAt } });
});

app.delete("/api/admin/companies/:id", authenticateToken, requireAdmin, (req: any, res) => {
  const companyId = Number(req.params.id);
  const existing = db.prepare("SELECT id, name FROM companies WHERE id = ?").get(companyId) as { id: number; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "Company not found" });

  const hasUsers = db.prepare("SELECT 1 FROM users WHERE company_id = ? LIMIT 1").get(companyId);
  if (hasUsers) return res.status(400).json({ error: "Cannot delete a company with assigned users" });

  db.prepare("DELETE FROM companies WHERE id = ?").run(companyId);
  logEvent("company_deleted", { category: "company_mgmt", actorUserId: req.user.id, metadata: { companyId, name: existing.name } });

  res.json({ success: true });
});

// Data Routes
app.get("/api/data", authenticateToken, (req: any, res) => {
  res.json(listVisibleRowsForUser(req.user.id, false));
});

app.get("/api/data/deleted", authenticateToken, (req: any, res) => {
  res.json(listVisibleRowsForUser(req.user.id, true));
});

app.post("/api/data/sync", authenticateToken, (req: any, res) => {
  const { rows } = req.body;
  if (!validateRowsPayload(rows)) {
    return res.status(400).json({ error: "Rows must be an array of at most 5000 objects with string ids" });
  }

  const userId = req.user.id;

  // This loop used to run getRowAccessForUser / getVisibleUserIdsFor* per row
  // (each up to several queries), so syncing a large table meant thousands of
  // synchronous round trips inside one transaction. Batch-fetch everything a
  // sync of this payload could possibly need up front instead.
  const ids = Array.from(new Set((rows as any[]).map((r) => r?.id).filter((id): id is string => typeof id === "string")));
  const existingById = new Map<string, LogisticsRowRecord>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    (db.prepare(`SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id IN (${placeholders})`)
      .all(...ids) as LogisticsRowRecord[])
      .forEach((r) => existingById.set(r.id, r));
  }

  // The current user's own row/group/agency shares — reused both for the
  // edit-permission check on existing rows and the insert-permission check
  // on new ones (the original code queried these individually for each).
  const rowRoles = new Map<string, ShareRole>(
    (db.prepare("SELECT row_id, role FROM trip_row_access WHERE user_id = ?").all(userId) as { row_id: string; role: string }[])
      .map((r) => [r.row_id, normalizeShareRole(r.role)]),
  );
  const groupRoles = new Map<string, ShareRole>(
    (db.prepare("SELECT group_no, role FROM trip_group_access WHERE user_id = ?").all(userId) as { group_no: string; role: string }[])
      .map((r) => [r.group_no, normalizeShareRole(r.role)]),
  );
  const agencyRoles = new Map<string, ShareRole>(
    (db.prepare("SELECT agency, role FROM trip_agency_access WHERE user_id = ?").all(userId) as { agency: string; role: string }[])
      .map((r) => [r.agency, normalizeShareRole(r.role)]),
  );
  const resolveAccess = (record: LogisticsRowRecord): { scope: AccessScope; role: AccessRole } | null => {
    if (Number(record.user_id) === Number(userId)) return { scope: "owner", role: "owner" };
    const candidates: { scope: AccessScope; role: ShareRole }[] = [];
    const rowRole = rowRoles.get(record.id);
    if (rowRole) candidates.push({ scope: "row", role: rowRole });
    const parsed = parseRowData(record.data);
    if (parsed.groupNo) {
      const groupRole = groupRoles.get(String(parsed.groupNo));
      if (groupRole) candidates.push({ scope: "group", role: groupRole });
    }
    const agency = normalizeAgency(parsed.agency);
    if (agency) {
      const agencyRole = agencyRoles.get(agency);
      if (agencyRole) candidates.push({ scope: "agency", role: agencyRole });
    }
    const editorAccess = candidates.find((access) => access.role === "editor");
    return editorAccess ?? candidates[0] ?? null;
  };

  // Everyone (any user, not just req.user) who can see a given row/group/agency —
  // needed to fan out the live-update notification. Scoped to the identifiers
  // this payload could actually touch (existing rows' own groupNo/agency, plus
  // every incoming row's), fetched in 3 queries instead of per row.
  const groupNosInvolved = new Set<string>();
  const agenciesInvolved = new Set<string>();
  for (const record of existingById.values()) {
    const parsed = parseRowData(record.data);
    if (parsed.groupNo) groupNosInvolved.add(String(parsed.groupNo));
    const agencyFromRecord = normalizeAgency(parsed.agency);
    if (agencyFromRecord) agenciesInvolved.add(agencyFromRecord);
  }
  for (const row of rows as any[]) {
    const stored = sanitizeRowForStorage(row);
    const groupNo = String(stored.groupNo || "").trim();
    if (groupNo) groupNosInvolved.add(groupNo);
    const agencyFromRow = normalizeAgency(stored.agency);
    if (agencyFromRow) agenciesInvolved.add(agencyFromRow);
  }
  const rowIdToUserIds = new Map<string, Set<number>>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    (db.prepare(`SELECT row_id, user_id FROM trip_row_access WHERE row_id IN (${placeholders})`).all(...ids) as { row_id: string; user_id: number }[])
      .forEach(({ row_id, user_id: uid }) => {
        if (!rowIdToUserIds.has(row_id)) rowIdToUserIds.set(row_id, new Set());
        rowIdToUserIds.get(row_id)!.add(Number(uid));
      });
  }
  const groupNoToUserIds = new Map<string, Set<number>>();
  if (groupNosInvolved.size > 0) {
    const groupList = Array.from(groupNosInvolved);
    const placeholders = groupList.map(() => "?").join(",");
    (db.prepare(`SELECT group_no, user_id FROM trip_group_access WHERE group_no IN (${placeholders})`).all(...groupList) as { group_no: string; user_id: number }[])
      .forEach(({ group_no, user_id: uid }) => {
        if (!groupNoToUserIds.has(group_no)) groupNoToUserIds.set(group_no, new Set());
        groupNoToUserIds.get(group_no)!.add(Number(uid));
      });
  }
  const agencyToUserIds = new Map<string, Set<number>>();
  if (agenciesInvolved.size > 0) {
    const agencyList = Array.from(agenciesInvolved);
    const placeholders = agencyList.map(() => "?").join(",");
    (db.prepare(`SELECT agency, user_id FROM trip_agency_access WHERE agency IN (${placeholders})`).all(...agencyList) as { agency: string; user_id: number }[])
      .forEach(({ agency, user_id: uid }) => {
        if (!agencyToUserIds.has(agency)) agencyToUserIds.set(agency, new Set());
        agencyToUserIds.get(agency)!.add(Number(uid));
      });
  }
  const visibleUserIdsForRowRecord = (record: LogisticsRowRecord): Set<number> => {
    const userIds = new Set<number>([Number(record.user_id)]);
    (rowIdToUserIds.get(record.id) ?? new Set()).forEach((id) => userIds.add(id));
    const parsed = parseRowData(record.data);
    if (parsed.groupNo) (groupNoToUserIds.get(String(parsed.groupNo)) ?? new Set()).forEach((id) => userIds.add(id));
    const agencyFromRecord = normalizeAgency(parsed.agency);
    if (agencyFromRecord) (agencyToUserIds.get(agencyFromRecord) ?? new Set()).forEach((id) => userIds.add(id));
    return userIds;
  };
  const visibleUserIdsForGroupNo = (groupNo: string, ownerUserId: number): Set<number> => {
    const userIds = new Set<number>([Number(ownerUserId)]);
    (groupNoToUserIds.get(groupNo) ?? new Set()).forEach((id) => userIds.add(id));
    return userIds;
  };
  const visibleUserIdsForAgency = (agency: string, ownerUserId: number): Set<number> => {
    const userIds = new Set<number>([Number(ownerUserId)]);
    (agencyToUserIds.get(normalizeAgency(agency)) ?? new Set()).forEach((id) => userIds.add(id));
    return userIds;
  };

  const insertStmt = db.prepare("INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)");
  const updateStmt = db.prepare("UPDATE logistics_rows SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  const affectedUserIds = new Set<number>();
  const conflicts: any[] = [];

  const sync = db.transaction((rows) => {
    for (const row of rows) {
      if (!row?.id) continue;
      // existingById is kept in sync as we go (not just a static pre-fetch), so a
      // duplicate id within the same payload still sees its own prior write here,
      // exactly as a fresh SELECT would have.
      const existing = existingById.get(row.id);

      const storedRow = sanitizeRowForStorage(row);
      if (existing) {
        const access = resolveAccess(existing);
        if (access && canEditAccessRole(access.role) && !existing.deleted_at) {
          const current = parseRowData(existing.data);
          const next = { ...current, ...storedRow, id: current.id };
          if (row._version !== undefined && Number(row._version) !== Number(existing.version)) {
            if (JSON.stringify(next) !== JSON.stringify(current)) {
              conflicts.push({ id: existing.id, row: decorateRowForUser(existing, userId, access) });
            }
            continue;
          }
          updateStmt.run(JSON.stringify(next), existing.id);
          visibleUserIdsForRowRecord(existing).forEach((id) => affectedUserIds.add(id));
          existingById.set(existing.id, { ...existing, data: JSON.stringify(next), version: Number(existing.version || 1) + 1 });
        }
      } else {
        // `_version` is only ever handed out by the server, so a row that carries one
        // but no longer exists here was permanently deleted while this client was out
        // of date. Re-inserting it is how a tab that still held its pre-overwrite row
        // set used to resurrect the trips an extension capture had just replaced.
        if (row._version !== undefined) continue;

        const groupNo = String(storedRow.groupNo || "").trim();
        const agency = normalizeAgency(storedRow.agency);
        if (groupNo) {
          const groupRole = groupRoles.get(groupNo);
          const agencyRole = agency ? agencyRoles.get(agency) : undefined;
          const hasReadonlySharedScope = [groupRole, agencyRole].some((role) => role && !canEditAccessRole(role));
          const hasEditableSharedScope = [groupRole, agencyRole].some((role) => role && canEditAccessRole(role));
          if (hasReadonlySharedScope && !hasEditableSharedScope) continue;
        } else if (agency) {
          const agencyRole = agencyRoles.get(agency);
          if (agencyRole && !canEditAccessRole(agencyRole)) continue;
        }
        insertStmt.run(row.id, userId, JSON.stringify(storedRow));
        const recipients = new Set<number>([userId]);
        if (groupNo) visibleUserIdsForGroupNo(groupNo, userId).forEach((id) => recipients.add(id));
        if (agency) visibleUserIdsForAgency(agency, userId).forEach((id) => recipients.add(id));
        recipients.forEach((id) => affectedUserIds.add(id));
        existingById.set(row.id, { id: row.id, user_id: userId, data: JSON.stringify(storedRow), version: 1, updated_at: new Date().toISOString(), deleted_at: null as any, deleted_by_user_id: null as any });
      }
    }
  });

  sync(rows);
  if (rows.length > 0) {
    logEvent("data_synced", { category: "data", actorUserId: req.user.id, metadata: { rowCount: rows.length } });
  }
  if (conflicts.length > 0) {
    sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
    return res.status(409).json({ success: false, code: "CONFLICT", conflicts });
  }
  sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
  res.json({ success: true });
});

app.patch("/api/data/:id", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, false);
  if (!visible) return res.status(404).json({ error: "Trip not found" });

  const updates = req.body?.updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return res.status(400).json({ error: "Invalid updates" });
  }

  const access = getRowAccessForUser(req.user.id, visible);
  if (!canEditAccessRole(access?.role)) return res.status(403).json({ error: "Insufficient permission" });

  const baseVersion = req.body?.baseVersion;
  if (baseVersion !== undefined && Number(baseVersion) !== Number(visible.version)) {
    return res.status(409).json({
      error: "Trip was updated elsewhere",
      code: "CONFLICT",
      row: decorateRowForUser(visible, req.user.id),
    });
  }

  const current = parseRowData(visible.data);
  const updated = sanitizeRowForStorage({ ...current, ...updates, id: current.id });
  db.prepare("UPDATE logistics_rows SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(JSON.stringify(updated), visible.id);

  const refreshed = getVisibleRowForUser(req.user.id, visible.id, false) as LogisticsRowRecord;
  sendLiveEvent(getVisibleUserIdsForRowRecord(refreshed), "rows_changed", req.user.id);
  logEvent("row_updated", { category: "data", actorUserId: req.user.id, metadata: { rowId: visible.id } });
  res.json({ success: true, row: decorateRowForUser(refreshed, req.user.id) });
});

// Deleting is idempotent. The browser's copy of a row goes stale constantly — a
// teammate deletes it, an extension capture overwrites its group, another tab beats
// this one to it — and the old 404 turned every one of those into a hard "فشل حذف
// الرحلة" that no retry could clear, because the retry 404'd too. A row that is
// already gone, or that the caller cannot see, is a delete that is already done.
app.post("/api/data/:id/delete", authenticateToken, (req: any, res) => {
  const record = getRowRecordById(req.params.id);
  const access = record ? getRowAccessForUser(req.user.id, record) : null;
  if (!record || !access) return res.json({ success: true, alreadyDeleted: true });
  if (!canEditAccessRole(access.role)) return res.status(403).json({ error: "Insufficient permission" });
  if (record.deleted_at) return res.json({ success: true, alreadyDeleted: true });
  const visible = record;

  db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.user.id, visible.id);

  sendLiveEvent(getVisibleUserIdsForRowId(visible.id), "rows_changed", req.user.id);
  logEvent("row_deleted", { category: "data", actorUserId: req.user.id, metadata: { rowId: visible.id } });
  res.json({ success: true });
});

app.post("/api/data/:id/restore", authenticateToken, (req: any, res) => {
  const record = getRowRecordById(req.params.id);
  const access = record ? getRowAccessForUser(req.user.id, record) : null;
  if (!record || !access) return res.json({ success: true, alreadyRestored: true });
  if (!canEditAccessRole(access.role)) return res.status(403).json({ error: "Insufficient permission" });
  if (!record.deleted_at) return res.json({ success: true, alreadyRestored: true });
  const visible = record;

  db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = NULL, deleted_by_user_id = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(visible.id);

  sendLiveEvent(getVisibleUserIdsForRowId(visible.id), "rows_changed", req.user.id);
  logEvent("row_restored", { category: "data", actorUserId: req.user.id, metadata: { rowId: visible.id } });
  res.json({ success: true });
});

app.delete("/api/data/deleted", authenticateToken, (req: any, res) => {
  const records = db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE user_id = ? AND deleted_at IS NOT NULL")
    .all(req.user.id) as LogisticsRowRecord[];

  const affectedUserIds = new Set<number>([Number(req.user.id)]);
  records.forEach((record) => {
    getVisibleUserIdsForRowRecord(record).forEach((id) => affectedUserIds.add(id));
  });

  const deleteRows = db.transaction((rows: LogisticsRowRecord[]) => {
    const deleteRowAccess = db.prepare("DELETE FROM trip_row_access WHERE row_id = ?");
    const deleteInvitations = db.prepare("DELETE FROM trip_share_invitations WHERE row_id = ?");
    const deleteRow = db.prepare("DELETE FROM logistics_rows WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL");

    for (const row of rows) {
      deleteRowAccess.run(row.id);
      deleteInvitations.run(row.id);
      deleteRow.run(row.id, req.user.id);
    }

    removeRowsFromDeletedMirror(req.user.id, rows.map((row) => row.id));
  });

  deleteRows(records);
  sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
  logEvent("rows_purged_bulk", { category: "data", actorUserId: req.user.id, metadata: { count: records.length } });
  res.json({ success: true, deletedCount: records.length });
});

app.delete("/api/data/:id", authenticateToken, (req: any, res) => {
  const record = getRowRecordById(req.params.id);
  const access = record ? getRowAccessForUser(req.user.id, record) : null;
  // Same idempotency rule as the soft delete: already purged is a purge that worked.
  if (!record || !access) {
    removeRowsFromDeletedMirror(req.user.id, [req.params.id]);
    return res.json({ success: true, alreadyDeleted: true });
  }
  if (Number(record.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "Only the owner can permanently delete a trip" });
  if (!record.deleted_at) return res.status(409).json({ error: "Move the trip to the recycle bin before deleting it permanently" });
  const visible = record;

  const affectedUserIds = getVisibleUserIdsForRowRecord(visible);
  db.transaction(() => {
    db.prepare("DELETE FROM trip_row_access WHERE row_id = ?").run(visible.id);
    db.prepare("DELETE FROM trip_share_invitations WHERE row_id = ?").run(visible.id);
    db.prepare("DELETE FROM logistics_rows WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL").run(visible.id, req.user.id);
    removeRowsFromDeletedMirror(req.user.id, [visible.id]);
  })();

  sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
  logEvent("row_purged", { category: "data", actorUserId: req.user.id, metadata: { rowId: visible.id } });
  res.json({ success: true });
});

// One atomic request for "empty the bin" / "delete everything shown" instead of the
// browser firing one HTTP call per row. The old client-side Promise.all was
// all-or-nothing: a single 404 rejected the batch, the local state was never
// updated, and every retry then failed on the rows that had actually succeeded.
app.post("/api/data/bulk", authenticateToken, (req: any, res) => {
  const action = String(req.body?.action || "");
  const ids = req.body?.ids;
  if (!["delete", "restore", "purge"].includes(action)) {
    return res.status(400).json({ error: "action must be one of: delete, restore, purge" });
  }
  if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((id) => typeof id === "string" && id.length <= 128)) {
    return res.status(400).json({ error: "ids must be an array of at most 5000 row ids" });
  }

  const processed: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const affectedUserIds = new Set<number>([Number(req.user.id)]);

  const softDelete = db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const restore = db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = NULL, deleted_by_user_id = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const dropRowAccess = db.prepare("DELETE FROM trip_row_access WHERE row_id = ?");
  const dropInvitations = db.prepare("DELETE FROM trip_share_invitations WHERE row_id = ?");
  const dropRow = db.prepare("DELETE FROM logistics_rows WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL");

  db.transaction(() => {
    for (const id of new Set<string>(ids)) {
      const record = getRowRecordById(id);
      const access = record ? getRowAccessForUser(req.user.id, record) : null;
      if (!record || !access) {
        // Invisible or already gone — the caller's intent is already satisfied.
        processed.push(id);
        continue;
      }
      getVisibleUserIdsForRowRecord(record).forEach((userId) => affectedUserIds.add(userId));

      if (action === "purge") {
        if (Number(record.user_id) !== Number(req.user.id)) {
          failed.push({ id, error: "Only the owner can permanently delete a trip" });
          continue;
        }
        if (!record.deleted_at) {
          failed.push({ id, error: "Move the trip to the recycle bin before deleting it permanently" });
          continue;
        }
        dropRowAccess.run(id);
        dropInvitations.run(id);
        dropRow.run(id, req.user.id);
        processed.push(id);
        continue;
      }

      if (!canEditAccessRole(access.role)) {
        failed.push({ id, error: "Insufficient permission" });
        continue;
      }
      if (action === "delete") {
        if (!record.deleted_at) softDelete.run(req.user.id, id);
      } else {
        if (record.deleted_at) restore.run(id);
      }
      processed.push(id);
    }

    if (action === "purge" || action === "restore") removeRowsFromDeletedMirror(req.user.id, processed);
  })();

  sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
  logEvent("bulk_operation", {
    category: "data",
    actorUserId: req.user.id,
    metadata: { action, processedCount: processed.length, failedCount: failed.length },
  });
  res.json({ success: failed.length === 0, action, processed, failed });
});

// Sharing Routes
app.post("/api/shares/invitations", authenticateToken, (req: any, res) => {
  const { receiverUsername, scopeType, rowId, groupNo, agency } = req.body;
  const role = normalizeShareRole(req.body?.role);
  if (!receiverUsername || !scopeType) return res.status(400).json({ error: "Receiver and scope required" });
  if (!["row", "group", "agency"].includes(scopeType)) return res.status(400).json({ error: "Invalid share scope" });

  const receiverUsernameValue = normalizeUsername(receiverUsername);
  const normalizedRowIdInput = asTrimmedString(rowId, 128);
  const normalizedGroupNoInput = asTrimmedString(groupNo, 64);
  const normalizedAgencyInput = asTrimmedString(agency, 200);

  const receiver = getUserByUsername(receiverUsernameValue);
  if (!receiver) return res.status(404).json({ error: "Receiver account not found" });
  if (Number(receiver.id) === Number(req.user.id)) return res.status(400).json({ error: "Cannot share with yourself" });

  let normalizedRowId: string | null = null;
  let normalizedGroupNo: string | null = null;
  let normalizedAgency: string | null = null;

  if (scopeType === "row") {
    if (!normalizedRowIdInput) return res.status(400).json({ error: "rowId is required" });
    const visible = getVisibleRowForUser(req.user.id, normalizedRowIdInput, true);
    if (!visible) return res.status(404).json({ error: "Trip not found" });
    if (!canEditAccessRole(getRowAccessForUser(req.user.id, visible)?.role)) {
      return res.status(403).json({ error: "Insufficient permission" });
    }
    normalizedRowId = normalizedRowIdInput;
  } else if (scopeType === "group") {
    if (!normalizedGroupNoInput) return res.status(400).json({ error: "groupNo is required" });
    normalizedGroupNo = normalizedGroupNoInput;
    const canShareGroup = listVisibleRowsForUser(req.user.id, false)
      .some((row: any) => String(row.groupNo || "").trim() === normalizedGroupNo);
    const hasGroupAccess = db
      .prepare("SELECT role FROM trip_group_access WHERE group_no = ? AND user_id = ?")
      .get(normalizedGroupNo, req.user.id);
    if (!canShareGroup && !hasGroupAccess) return res.status(404).json({ error: "Group not found" });
    const groupRole = hasGroupAccess ? (hasGroupAccess as any).role : "owner";
    if (hasGroupAccess && !canEditAccessRole(groupRole)) {
      return res.status(403).json({ error: "Insufficient permission" });
    }
  } else {
    normalizedAgency = normalizeAgency(normalizedAgencyInput);
    if (!normalizedAgency) return res.status(400).json({ error: "agency is required" });
    const canShareAgency = listVisibleRowsForUser(req.user.id, false)
      .some((row: any) => normalizeAgency(row.agency) === normalizedAgency);
    const hasAgencyAccess = db
      .prepare("SELECT role FROM trip_agency_access WHERE agency = ? AND user_id = ?")
      .get(normalizedAgency, req.user.id);
    if (!canShareAgency && !hasAgencyAccess) return res.status(404).json({ error: "Agency not found" });
    const agencyRole = hasAgencyAccess ? (hasAgencyAccess as any).role : "owner";
    if (hasAgencyAccess && !canEditAccessRole(agencyRole)) {
      return res.status(403).json({ error: "Insufficient permission" });
    }
  }

  const existingAccess = scopeType === "row"
    ? db.prepare("SELECT 1 FROM trip_row_access WHERE row_id = ? AND user_id = ?").get(normalizedRowId, receiver.id)
    : scopeType === "group"
      ? db.prepare("SELECT 1 FROM trip_group_access WHERE group_no = ? AND user_id = ?").get(normalizedGroupNo, receiver.id)
      : db.prepare("SELECT 1 FROM trip_agency_access WHERE agency = ? AND user_id = ?").get(normalizedAgency, receiver.id);
  if (existingAccess) return res.status(400).json({ error: "User already has access" });

  const existingInvite: any = db.prepare(`
    SELECT * FROM trip_share_invitations
    WHERE receiver_user_id = ?
      AND scope_type = ?
      AND COALESCE(row_id, '') = COALESCE(?, '')
      AND COALESCE(group_no, '') = COALESCE(?, '')
      AND COALESCE(agency, '') = COALESCE(?, '')
      AND status = 'pending'
  `).get(receiver.id, scopeType, normalizedRowId, normalizedGroupNo, normalizedAgency);
  if (existingInvite) {
    return res.json({
      success: true,
      invitation: {
        id: existingInvite.id,
        scopeType: existingInvite.scope_type,
        rowId: existingInvite.row_id,
        groupNo: existingInvite.group_no,
        agency: existingInvite.agency,
        role: normalizeShareRole(existingInvite.role),
      },
    });
  }

  const info = db.prepare(`
    INSERT INTO trip_share_invitations (sender_user_id, receiver_user_id, scope_type, row_id, group_no, agency, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, receiver.id, scopeType, normalizedRowId, normalizedGroupNo, normalizedAgency, role);

  sendLiveEvent([receiver.id], "invitations_changed", req.user.id);
  logEvent("share_invitation_created", {
    category: "sharing",
    actorUserId: req.user.id,
    targetUserId: receiver.id,
    metadata: { scopeType, rowId: normalizedRowId, groupNo: normalizedGroupNo, agency: normalizedAgency, role },
  });

  res.json({
    success: true,
    invitation: {
      id: Number(info.lastInsertRowid),
      senderUsername: req.user.username,
      receiverUsername: receiver.username,
      scopeType,
      rowId: normalizedRowId,
      groupNo: normalizedGroupNo,
      agency: normalizedAgency,
      role,
    },
  });
});

app.get("/api/shares/invitations", authenticateToken, (req: any, res) => {
  const invitations = db.prepare(`
    SELECT i.id, i.scope_type, i.row_id, i.group_no, i.agency, i.role, i.created_at, u.username AS sender_username
    FROM trip_share_invitations i
    JOIN users u ON u.id = i.sender_user_id
    WHERE i.receiver_user_id = ? AND i.status = 'pending'
    ORDER BY i.created_at DESC
  `).all(req.user.id) as any[];

  res.json(invitations.map((invite) => ({
    id: invite.id,
    senderUsername: invite.sender_username,
    scopeType: invite.scope_type,
    rowId: invite.row_id,
    groupNo: invite.group_no,
    agency: invite.agency,
    role: normalizeShareRole(invite.role),
    createdAt: invite.created_at,
  })));
});

app.post("/api/shares/invitations/:id/accept", authenticateToken, (req: any, res) => {
  const invitation: any = db.prepare(`
    SELECT * FROM trip_share_invitations
    WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
  `).get(req.params.id, req.user.id);
  if (!invitation) return res.status(404).json({ error: "Invitation not found" });
  const role = normalizeShareRole(invitation.role);

  if (invitation.scope_type === "row") {
    db.prepare(`
      INSERT OR IGNORE INTO trip_row_access (row_id, user_id, granted_by_user_id, role)
      VALUES (?, ?, ?, ?)
    `).run(invitation.row_id, req.user.id, invitation.sender_user_id, role);
  } else if (invitation.scope_type === "group") {
    const insertGroupAccess = db.prepare(`
      INSERT OR IGNORE INTO trip_group_access (group_no, user_id, granted_by_user_id, role)
      VALUES (?, ?, ?, ?)
    `);
    insertGroupAccess.run(invitation.group_no, invitation.sender_user_id, invitation.sender_user_id, "editor");
    insertGroupAccess.run(invitation.group_no, req.user.id, invitation.sender_user_id, role);
  } else if (invitation.scope_type === "agency") {
    const insertAgencyAccess = db.prepare(`
      INSERT OR IGNORE INTO trip_agency_access (agency, user_id, granted_by_user_id, role)
      VALUES (?, ?, ?, ?)
    `);
    insertAgencyAccess.run(invitation.agency, invitation.sender_user_id, invitation.sender_user_id, "editor");
    insertAgencyAccess.run(invitation.agency, req.user.id, invitation.sender_user_id, role);
  }

  db.prepare(`
    UPDATE trip_share_invitations
    SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(invitation.id);

  sendLiveEvent([invitation.sender_user_id, req.user.id], "invitations_changed", req.user.id);
  if (invitation.scope_type === "row") {
    sendLiveEvent(getVisibleUserIdsForRowId(invitation.row_id), "rows_changed", req.user.id);
  } else if (invitation.scope_type === "group") {
    sendLiveEvent(getVisibleUserIdsForGroupNo(invitation.group_no, invitation.sender_user_id), "rows_changed", req.user.id);
  } else if (invitation.scope_type === "agency") {
    sendLiveEvent(getVisibleUserIdsForAgency(invitation.agency, invitation.sender_user_id), "rows_changed", req.user.id);
  }
  logEvent("share_invitation_accepted", {
    category: "sharing",
    actorUserId: req.user.id,
    targetUserId: invitation.sender_user_id,
    metadata: { scopeType: invitation.scope_type },
  });
  res.json({ success: true });
});

app.post("/api/shares/invitations/:id/decline", authenticateToken, (req: any, res) => {
  const invitation: any = db.prepare(`
    SELECT * FROM trip_share_invitations
    WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
  `).get(req.params.id, req.user.id);
  if (!invitation) return res.status(404).json({ error: "Invitation not found" });

  db.prepare(`
    UPDATE trip_share_invitations
    SET status = 'declined', responded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(invitation.id);

  sendLiveEvent([invitation.sender_user_id, req.user.id], "invitations_changed", req.user.id);
  logEvent("share_invitation_declined", {
    category: "sharing",
    actorUserId: req.user.id,
    targetUserId: invitation.sender_user_id,
    metadata: { scopeType: invitation.scope_type },
  });
  res.json({ success: true });
});

app.get("/api/shares/access", authenticateToken, (req: any, res) => {
  const rowAccess = db.prepare(`
    SELECT
      a.row_id AS row_id,
      a.user_id AS user_id,
      a.role AS role,
      a.created_at AS created_at,
      u.username AS username,
      r.data AS row_data
    FROM trip_row_access a
    JOIN users u ON u.id = a.user_id
    JOIN logistics_rows r ON r.id = a.row_id
    WHERE a.user_id != ?
      AND (a.granted_by_user_id = ? OR r.user_id = ?)
    ORDER BY a.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id) as any[];

  const groupAccess = db.prepare(`
    SELECT
      a.group_no AS group_no,
      a.user_id AS user_id,
      a.role AS role,
      a.created_at AS created_at,
      u.username AS username
    FROM trip_group_access a
    JOIN users u ON u.id = a.user_id
    WHERE a.user_id != ?
      AND a.granted_by_user_id = ?
    ORDER BY a.created_at DESC
  `).all(req.user.id, req.user.id) as any[];

  const agencyAccess = db.prepare(`
    SELECT
      a.agency AS agency,
      a.user_id AS user_id,
      a.role AS role,
      a.created_at AS created_at,
      u.username AS username
    FROM trip_agency_access a
    JOIN users u ON u.id = a.user_id
    WHERE a.user_id != ?
      AND a.granted_by_user_id = ?
    ORDER BY a.created_at DESC
  `).all(req.user.id, req.user.id) as any[];

  res.json([
    ...rowAccess.map((item) => {
      const row = parseRowData(item.row_data);
      return {
        scopeType: "row",
        rowId: item.row_id,
        userId: Number(item.user_id),
        username: item.username,
        role: normalizeShareRole(item.role),
        createdAt: item.created_at,
        rowSummary: `${row.groupName || "-"} (${row.groupNo || "-"}) - ${row.Column1 || "-"}`,
      };
    }),
    ...groupAccess.map((item) => ({
      scopeType: "group",
      groupNo: item.group_no,
      userId: Number(item.user_id),
      username: item.username,
      role: normalizeShareRole(item.role),
      createdAt: item.created_at,
      rowSummary: `Group ${item.group_no}`,
    })),
    ...agencyAccess.map((item) => ({
      scopeType: "agency",
      agency: item.agency,
      userId: Number(item.user_id),
      username: item.username,
      role: normalizeShareRole(item.role),
      createdAt: item.created_at,
      rowSummary: `Agency ${item.agency}`,
    })),
  ]);
});

app.patch("/api/shares/access", authenticateToken, (req: any, res) => {
  const { scopeType, rowId, groupNo, agency, userId } = req.body;
  const role = normalizeShareRole(req.body?.role);
  if (!["row", "group", "agency"].includes(scopeType) || !userId) return res.status(400).json({ error: "Invalid access target" });

  if (scopeType === "row") {
    if (!rowId) return res.status(400).json({ error: "rowId is required" });
    const record = db
      .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
      .get(String(rowId)) as LogisticsRowRecord | undefined;
    if (!record) return res.status(404).json({ error: "Trip not found" });
    const info = db.prepare(`
      UPDATE trip_row_access
      SET role = ?
      WHERE row_id = ? AND user_id = ?
        AND (granted_by_user_id = ? OR ? = ?)
    `).run(role, String(rowId), Number(userId), req.user.id, Number(record.user_id), Number(req.user.id));
    if (info.changes === 0) return res.status(404).json({ error: "Access not found" });
    sendLiveEvent(getVisibleUserIdsForRowId(String(rowId)), "rows_changed", req.user.id);
    logEvent("share_access_updated", { category: "sharing", actorUserId: req.user.id, targetUserId: Number(userId), metadata: { scopeType, role } });
    return res.json({ success: true });
  }

  if (scopeType === "group") {
    if (!groupNo) return res.status(400).json({ error: "groupNo is required" });
    const info = db.prepare(`
      UPDATE trip_group_access
      SET role = ?
      WHERE group_no = ? AND user_id = ? AND granted_by_user_id = ?
    `).run(role, String(groupNo).trim(), Number(userId), req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: "Access not found" });
    sendLiveEvent([Number(userId), req.user.id], "rows_changed", req.user.id);
    logEvent("share_access_updated", { category: "sharing", actorUserId: req.user.id, targetUserId: Number(userId), metadata: { scopeType, role } });
    return res.json({ success: true });
  }

  const normalizedAgency = normalizeAgency(agency);
  if (!normalizedAgency) return res.status(400).json({ error: "agency is required" });
  const info = db.prepare(`
    UPDATE trip_agency_access
    SET role = ?
    WHERE agency = ? AND user_id = ? AND granted_by_user_id = ?
  `).run(role, normalizedAgency, Number(userId), req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: "Access not found" });
  sendLiveEvent([Number(userId), req.user.id], "rows_changed", req.user.id);
  logEvent("share_access_updated", { category: "sharing", actorUserId: req.user.id, targetUserId: Number(userId), metadata: { scopeType, role } });
  return res.json({ success: true });
});

app.delete("/api/shares/access", authenticateToken, (req: any, res) => {
  const { scopeType, rowId, groupNo, agency, userId } = req.body;
  if (!["row", "group", "agency"].includes(scopeType) || !userId) return res.status(400).json({ error: "Invalid access target" });

  if (scopeType === "row") {
    if (!rowId) return res.status(400).json({ error: "rowId is required" });
    const record = db
      .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
      .get(String(rowId)) as LogisticsRowRecord | undefined;
    if (!record) return res.status(404).json({ error: "Trip not found" });
    const info = db.prepare(`
      DELETE FROM trip_row_access
      WHERE row_id = ? AND user_id = ?
        AND (granted_by_user_id = ? OR ? = ?)
    `).run(String(rowId), Number(userId), req.user.id, Number(record.user_id), Number(req.user.id));
    if (info.changes === 0) return res.status(404).json({ error: "Access not found" });
    sendLiveEvent([Number(userId), req.user.id], "rows_changed", req.user.id);
    logEvent("share_access_revoked", { category: "sharing", actorUserId: req.user.id, targetUserId: Number(userId), metadata: { scopeType } });
    return res.json({ success: true });
  }

  if (scopeType === "group") {
    if (!groupNo) return res.status(400).json({ error: "groupNo is required" });
    const info = db.prepare(`
      DELETE FROM trip_group_access
      WHERE group_no = ? AND user_id = ? AND granted_by_user_id = ?
    `).run(String(groupNo).trim(), Number(userId), req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: "Access not found" });
    sendLiveEvent([Number(userId), req.user.id], "rows_changed", req.user.id);
    logEvent("share_access_revoked", { category: "sharing", actorUserId: req.user.id, targetUserId: Number(userId), metadata: { scopeType } });
    return res.json({ success: true });
  }

  const normalizedAgency = normalizeAgency(agency);
  if (!normalizedAgency) return res.status(400).json({ error: "agency is required" });
  const info = db.prepare(`
    DELETE FROM trip_agency_access
    WHERE agency = ? AND user_id = ? AND granted_by_user_id = ?
  `).run(normalizedAgency, Number(userId), req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: "Access not found" });
  sendLiveEvent([Number(userId), req.user.id], "rows_changed", req.user.id);
  logEvent("share_access_revoked", { category: "sharing", actorUserId: req.user.id, targetUserId: Number(userId), metadata: { scopeType } });
  return res.json({ success: true });
});

// Settings Routes
app.get("/api/settings", authenticateToken, (req: any, res) => {
  const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);
  if (!settings) return res.json({ tgConfig: null, templates: [], fontSize: 100 });
  const extraSettings = parseExtraSettings(settings.extra_settings);

  res.json({
    tgConfig: decryptJson<StoredTelegramConfig | null>(settings.tg_config, null),
    templates: parseStoredJson(settings.templates, []),
    deletedRows: parseStoredJson(settings.deleted_rows, []),
    notifiedIds: parseStoredJson(settings.notified_ids, []),
    fontSize: settings.font_size || 100,
    ...extraSettings
  });
});

app.post("/api/settings", authenticateToken, (req: any, res) => {
  const { tgConfig, templates, deletedRows, notifiedIds, fontSize, alertSettings, previewSettings, displaySettings } = req.body;

  // Merge with existing settings so partial saves never wipe unrelated fields
  const existing: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);
  const existingExtraSettings = parseExtraSettings(existing?.extra_settings);

  const merged = {
    tg_config: tgConfig !== undefined ? (tgConfig ? encryptJson(tgConfig) : null)
      : (existing?.tg_config ?? null),
    templates: templates !== undefined ? (templates ? JSON.stringify(templates) : null)
      : (existing?.templates ?? null),
    deleted_rows: deletedRows !== undefined ? (deletedRows ? JSON.stringify(deletedRows) : null)
      : (existing?.deleted_rows ?? null),
    notified_ids: existing?.notified_ids ?? null,
    font_size: fontSize !== undefined ? fontSize : (existing?.font_size ?? 100),
    extra_settings: JSON.stringify({
      alertSettings: alertSettings !== undefined ? alertSettings : existingExtraSettings.alertSettings,
      previewSettings: previewSettings !== undefined ? previewSettings : existingExtraSettings.previewSettings,
      displaySettings: displaySettings !== undefined ? displaySettings : existingExtraSettings.displaySettings,
    }),
  };

  db.prepare(`
    INSERT INTO settings (user_id, tg_config, templates, deleted_rows, notified_ids, font_size, extra_settings)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tg_config     = excluded.tg_config,
      templates     = excluded.templates,
      deleted_rows  = excluded.deleted_rows,
      notified_ids  = excluded.notified_ids,
      font_size     = excluded.font_size,
      extra_settings = excluded.extra_settings
  `).run(
    req.user.id,
    merged.tg_config,
    merged.templates,
    merged.deleted_rows,
    merged.notified_ids,
    merged.font_size,
    merged.extra_settings
  );

  if (tgConfig !== undefined) {
    logEvent("telegram_config_updated", { category: "settings", actorUserId: req.user.id });
  }

  res.json({ success: true });
});

// Account Routes
app.get("/api/account", authenticateToken, (req: any, res) => {
  const user: any = db.prepare("SELECT id, username, company_name, avatar FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    id: Number(user.id),
    username: user.username,
    companyName: user.company_name ?? null,
    avatar: user.avatar ?? null,
  });
});

app.patch("/api/account", authenticateToken, async (req: any, res) => {
  const { companyName, avatar, username, newPassword, currentPassword } = req.body;

  const existing: any = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!existing) return res.status(401).json({ error: "Unauthorized" });

  const wantsUsernameChange = username !== undefined;
  const wantsPasswordChange = newPassword !== undefined;

  // Changing credentials requires proving the current password first, so a
  // stolen/short-lived page session can't silently take over the account.
  if (wantsUsernameChange || wantsPasswordChange) {
    if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, existing.password))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }

  let nextUsername = existing.username;
  if (wantsUsernameChange) {
    const normalized = normalizeUsername(username);
    if (!isValidUsername(normalized)) {
      return res.status(400).json({ error: "Username must be 3-32 lowercase letters, numbers, underscores, or hyphens" });
    }
    nextUsername = normalized;
  }

  let nextPasswordHash = existing.password;
  if (wantsPasswordChange) {
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: "Password must be 10-128 characters" });
    }
    nextPasswordHash = await bcrypt.hash(newPassword, 10);
  }

  let nextCompanyName = existing.company_name;
  if (companyName !== undefined) {
    const trimmed = asTrimmedString(companyName, 200);
    nextCompanyName = trimmed || null;
  }

  let nextAvatar = existing.avatar;
  if (avatar !== undefined) {
    if (avatar === null) {
      nextAvatar = null;
    } else if (isValidAvatarDataUri(avatar)) {
      nextAvatar = avatar;
    } else {
      return res.status(400).json({ error: "Avatar must be a PNG, JPEG, WEBP, or GIF image under ~1MB" });
    }
  }

  try {
    db.prepare("UPDATE users SET username = ?, password = ?, company_name = ?, avatar = ? WHERE id = ?")
      .run(nextUsername, nextPasswordHash, nextCompanyName, nextAvatar, req.user.id);
  } catch (err: any) {
    if (err.code?.includes("SQLITE_CONSTRAINT")) {
      return res.status(400).json({ error: "Username already exists" });
    }
    return res.status(500).json({ error: "Server error" });
  }

  const changedFields = [
    wantsUsernameChange && "username",
    wantsPasswordChange && "password",
    companyName !== undefined && "companyName",
    avatar !== undefined && "avatar",
  ].filter(Boolean);
  logEvent("account_updated", { category: "settings", actorUserId: req.user.id, metadata: { fields: changedFields } });

  res.json(authResponse({
    id: req.user.id,
    username: nextUsername,
    company_name: nextCompanyName,
    avatar: nextAvatar,
    role: existing.role,
  }));
});

app.post("/api/telegram/test", authenticateToken, async (req: any, res) => {
  const token = String(req.body?.token || "").trim();
  const chatId = String(req.body?.chatId || "").trim();
  if (!token || !chatId) return res.status(400).json({ error: "Telegram token and chat ID are required" });

  const testMsg = `<b>اختبار اتصال نظام التفويج</b>\nتم الربط بنجاح! ستصلك التنبيهات هنا تلقائياً.\n<i>الوقت: ${new Date().toLocaleTimeString()}</i>`;
  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: testMsg, parse_mode: "HTML" }),
  });
  const data: any = await tgRes.json();
  if (!data.ok) return res.status(400).json({ error: "Telegram rejected the test message" });
  res.json({ success: true });
});

// Debug endpoint — shows what the alert worker sees for the logged-in user
app.get("/api/alerts/debug", authenticateToken, (req: any, res) => {
  const now = new Date();
  const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);

  const tgConfig = decryptJson<StoredTelegramConfig | null>(settings?.tg_config, null);
  const extraSettings = parseExtraSettings(settings?.extra_settings);
  const alertSettings = extraSettings.alertSettings ?? DEFAULT_ALERT_SETTINGS;
  const notifiedIds: string[] = parseStoredJson(settings?.notified_ids, []);
  const notifiedSet = new Set(notifiedIds);

  const rawRows = db
    .prepare("SELECT data FROM logistics_rows WHERE user_id = ?")
    .all(req.user.id) as { data: string }[];

  const tripDiagnostics = rawRows.map(({ data }) => {
    const row = JSON.parse(data);
    const tripDate = parseDateTime(row.date, row.time);
    const diffMinutes = tripDate ? (tripDate.getTime() - now.getTime()) / (1000 * 60) : null;
    const alreadyNotified = notifiedSet.has(row.id);
    const isArrival = row.Column1?.includes('وصول');
    const isDeparture = row.Column1?.includes('مغادرة');
    const windowMinutes = isArrival
      ? alertSettings.arrivalMinutes
      : isDeparture
      ? alertSettings.departureMinutes
      : Math.max(alertSettings.arrivalMinutes, alertSettings.departureMinutes);
    const wouldSend = !alreadyNotified && diffMinutes !== null && diffMinutes > 0 && diffMinutes <= windowMinutes;
    const skipReason = alreadyNotified
      ? 'already notified'
      : !row.date || !row.time
        ? 'missing date/time'
        : !tripDate
          ? 'date failed to parse'
          : diffMinutes !== null && diffMinutes <= 0
            ? `trip is in the past (${Math.abs(diffMinutes!).toFixed(0)} min ago)`
            : diffMinutes !== null && diffMinutes > windowMinutes
              ? `too far away (${diffMinutes.toFixed(0)} min from now, window is ${windowMinutes} min)`
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
    alertWindowMinutes: { arrival: alertSettings.arrivalMinutes, departure: alertSettings.departureMinutes },
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

// GET /api/check/group/:groupNo — used by extension to detect duplicates
app.get("/api/check/group/:groupNo", authenticateToken, (req: any, res) => {
  const groupNo = asTrimmedString(req.params.groupNo, 64);

  // Must answer the same question the user's screen does, otherwise the extension's
  // duplicate prompt lies in both directions: it used to count rows sitting in the
  // recycle bin (so it warned about groups the user had already deleted) while
  // ignoring rows shared in by a colleague (so it stayed silent about groups that
  // were plainly visible, and the capture landed as a second copy).
  //
  // Narrow by group number first and only then run the per-row access check, which
  // costs several queries each — the group is a handful of rows, the table is not.
  const candidates = db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE deleted_at IS NULL")
    .all() as LogisticsRowRecord[];

  const matches = candidates.filter((record) => {
    let stored: any;
    try { stored = parseRowData(record.data); } catch { return false; }
    if (!sameGroupNo(stored.groupNo, groupNo)) return false;
    return Boolean(getRowScopeForUser(req.user.id, record));
  });

  res.json({ exists: matches.length > 0, count: matches.length });
});

// POST /api/ingest/text — ingest raw itinerary text from browser extension
// Body: { text, groupNo, groupName, agency?, count, overwrite? }
app.post("/api/ingest/text", authenticateToken, (req: any, res) => {
  const { text, groupNo, groupName, agency = "", count, overwrite = false } = req.body;
  const textValue = asTrimmedString(text, 250_000);
  const groupNoValue = asTrimmedString(groupNo, 64);
  const groupNameValue = asTrimmedString(groupName, 200);
  const agencyValue = asTrimmedString(agency, 200);
  const countValue = asTrimmedString(count, 32);

  if (textValue.length < 5)
    return res.status(400).json({ error: "النص مطلوب ولا يمكن أن يكون فارغاً" });
  if (!groupNoValue || !groupNameValue || !countValue)
    return res.status(400).json({ error: "بيانات المجموعة مطلوبة (رقم، اسم، عدد)" });

  try {
    const newRows = (detectCaptureLang(textValue) === 'ar' ? parseItineraryText : parseItineraryTextEN)(textValue, {
      groupNo: groupNoValue,
      groupName: groupNameValue,
      agency: agencyValue,
      count: countValue,
    });

    if (newRows.length === 0)
      return res.status(422).json({ error: "لم يتم استخراج أي رحلات من النص", rows: [] });

    // Only the rows this capture actually changes get written.
    //
    // This endpoint used to DELETE every active row the user owned and re-INSERT the
    // whole set from JSON on every single capture. That had three consequences, and
    // together they account for most of the "the system is inconsistent" reports:
    //
    //   • The re-INSERT never carried `version` forward, so every row the user owned
    //     silently reset to version 1. Any tab that was open at the time instantly
    //     held a stale `_version` for all of its rows, and its next edit or
    //     background sync came back 409 — surfacing as "فشل مزامنة البيانات".
    //   • The old rows of an overwritten group were hard-deleted, leaving no
    //     tombstone. A tab that had not yet refreshed would replay its pre-overwrite
    //     row set on the next debounced sync and re-create them, so the user ended up
    //     holding both the old and the new copy of the group.
    //   • Rewriting ~1700 rows per capture made the whole thing slow enough to widen
    //     every one of those race windows, and forced the deferred-FK workaround
    //     below to keep the sharing grants from tripping over the delete.
    //
    // Overwrite now soft-deletes the group it replaces (recoverable from the recycle
    // bin, and a tombstone the sync endpoint honours), and untouched rows are not
    // written at all.
    const replaced: LogisticsRowRecord[] = [];
    if (overwrite) {
      const activeRecords = db
        .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE deleted_at IS NULL")
        .all() as LogisticsRowRecord[];
      for (const record of activeRecords) {
        let stored: any;
        try { stored = parseRowData(record.data); } catch { continue; }
        if (!sameGroupNo(stored.groupNo, groupNoValue)) continue;
        // Scoped to what the user can edit rather than what they own, so a group
        // shared in from a colleague is replaced too instead of lingering alongside
        // the new rows as a duplicate.
        if (!canEditAccessRole(getRowAccessForUser(req.user.id, record)?.role)) continue;
        replaced.push(record);
      }
    }

    const softDeleteStmt = db.prepare(`
      UPDATE logistics_rows
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `);
    const insertStmt = db.prepare(`
      INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        deleted_at = NULL,
        deleted_by_user_id = NULL,
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
    `);

    db.transaction(() => {
      for (const record of replaced) softDeleteStmt.run(req.user.id, record.id);
      for (const row of newRows) insertStmt.run(row.id, req.user.id, JSON.stringify(row));
    })();

    const affectedUserIds = new Set<number>([req.user.id]);
    replaced.forEach((record) => {
      getVisibleUserIdsForRowRecord(record).forEach((id) => affectedUserIds.add(id));
    });
    newRows.forEach((row: any) => {
      const rowGroupNo = String(row.groupNo || "").trim();
      const rowAgency = normalizeAgency(row.agency);
      if (rowGroupNo) getVisibleUserIdsForGroupNo(rowGroupNo, req.user.id).forEach((id) => affectedUserIds.add(id));
      if (rowAgency) getVisibleUserIdsForAgency(rowAgency, req.user.id).forEach((id) => affectedUserIds.add(id));
    });
    sendLiveEvent(affectedUserIds, "rows_changed");

    const action = overwrite ? "استبدال" : "إضافة";
    logEvent("ingest_processed", {
      category: "integration",
      actorUserId: req.user.id,
      metadata: { action: overwrite ? "overwrite" : "add", groupNo: groupNoValue, count: newRows.length },
    });

    res.json({ success: true, rows: newRows, message: `تم ${action} ${newRows.length} رحلة` });

  } catch (err: any) {
    logEvent("ingest_failed", {
      category: "integration",
      level: "error",
      actorUserId: req.user.id,
      metadata: { groupNo: groupNoValue, message: err.message },
    });
    res.status(500).json({ error: "خطأ في معالجة النص: " + err.message });
  }
});

// Extension distribution. The Chrome Web Store is the only channel now — the
// self-hosted CRX + updates.xml pipeline is gone, because the store rejects any
// package that carries an `update_url`. What is left is the store-ready zip, kept
// downloadable so it can be uploaded to the developer dashboard.
app.get("/api/extension/info", (_req, res) => {
  res.json(getExtensionInfo());
});

app.get("/api/download/extension", (_req, res) => {
  const info = getExtensionInfo();
  if (!info.hasZip) {
    res.status(404).json({ error: "ملف الإضافة غير موجود" });
    return;
  }
  res.download(info.zipPath, "umrah-extension.zip", (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "الملف غير موجود" });
  });
});

// Vite middleware for development
if (!["production", "staging"].includes(process.env.NODE_ENV || "") && !isTestEnv) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else if (isTestEnv) {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(APP_ROOT, "index.html"));
  });
  // Test-only route to exercise the error-handling middleware below without
  // relying on a real bug elsewhere in the app to throw on cue.
  app.get("/api/__test/throw", authenticateToken, () => {
    throw new Error("boom");
  });
} else if (!isTestEnv) {
  const distDir = path.join(APP_ROOT, "dist");
  app.use(express.static(distDir, {
    dotfiles: "deny",
    index: false,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));
  app.get("/", (_req, res) => {
    res.sendFile("index.html", { root: distDir });
  });
  app.get("/{*splat}", (req, res) => {
    res.sendFile("index.html", { root: distDir });
  });
}

// Catches anything an earlier route/middleware threw or forwarded via next(err)
// instead of handling itself. Must be registered after every other app.use/
// app.get/etc above. Logging here is best-effort (logEvent already guards its
// own failure) and never changes the response the caller would otherwise get.
app.use((err: any, req: any, res: any, _next: any) => {
  logEvent("unhandled_error", {
    category: "system",
    level: "error",
    actorUserId: req.user?.id ?? null,
    metadata: { method: req.method, path: req.path, message: String(err?.message || err) },
  });
  if (res.headersSent) return;
  // Errors with an explicit HTTP status (e.g. body-parser's 413 on an
  // oversized payload) keep that status; anything unexpected is a 500.
  const status = Number(err?.status || err?.statusCode) || 500;
  res.status(status).json({ error: status === 500 ? "Server error" : String(err?.message || "Request error") });
});

process.on("uncaughtException", (err) => {
  logEvent("process_error", { category: "system", level: "error", metadata: { kind: "uncaughtException", message: String(err?.message || err) } });
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logEvent("process_error", { category: "system", level: "error", metadata: { kind: "unhandledRejection", message: String((reason as any)?.message || reason) } });
  console.error("Unhandled rejection:", reason);
});

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

      const tgConfig = decryptJson<StoredTelegramConfig | null>(settings.tg_config, null);
      if (!tgConfig?.enabled || !tgConfig.token || !tgConfig.chatId) continue;

      const extraSettings = parseExtraSettings(settings.extra_settings);
      const alertSettings = extraSettings.alertSettings ?? DEFAULT_ALERT_SETTINGS;

      const notifiedSet = new Set<string>(parseStoredJson(settings.notified_ids, []));

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
            logEvent("telegram_alert_failed", {
              category: "integration",
              level: "error",
              targetUserId: userId,
              metadata: { rowId: row.id, reason: tgData.description },
            });
            continue; // Don't mark as notified — will retry next cycle
          }
          logEvent("telegram_alert_sent", { category: "integration", targetUserId: userId, metadata: { rowId: row.id } });
        } catch (fetchErr: any) {
          logEvent("telegram_alert_failed", {
            category: "integration",
            level: "error",
            targetUserId: userId,
            metadata: { rowId: row.id, reason: String(fetchErr?.message || fetchErr) },
          });
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

export { app, attachLiveUpdates, checkAndSendAlerts, pruneAuditLog, db };

if (!isTestEnv) {
  const server = http.createServer(app);
  // Node's default keepAliveTimeout (5s) can close a reused connection while
  // a slow handler (e.g. /api/data's per-row access checks over a large
  // table) is still synchronously computing its response, especially when
  // a real page load has many other requests (JS/CSS/images/WebSocket)
  // competing for the browser's limited per-origin connections. Raise both
  // well above any realistic handler time; headersTimeout must exceed
  // keepAliveTimeout per Node's docs.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  attachLiveUpdates(server);

  // Start alert worker immediately then every 60 s
  checkAndSendAlerts();
  setInterval(checkAndSendAlerts, 60_000);

  // Prune old audit_log rows immediately then once every 24 h
  pruneAuditLog();
  setInterval(pruneAuditLog, 24 * 60 * 60_000);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`[Alerts] Proximity alert worker started (60 s interval)`);
  });
}
