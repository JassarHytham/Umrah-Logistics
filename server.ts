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
import { existsSync } from "node:fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { parseDateTime, parseItineraryText, getCarType } from "./utils/parser.js";
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

const getExtensionChannel = () => {
  if (process.env.EXTENSION_CHANNEL === "staging") return "staging";
  if (process.env.EXTENSION_CHANNEL === "prod") return "prod";
  if (process.env.NODE_ENV === "staging") return "staging";
  if (String(process.env.PORT || PORT) === "3001") return "staging";
  return "prod";
};

const getExtensionInfo = () => {
  const channel = getExtensionChannel();
  const channelDir = path.join(APP_ROOT, "public", "extensions", channel);
  const crxPath = path.join(channelDir, "umrah-extension.crx");
  const zipPath = path.join(channelDir, "umrah-extension.zip");
  const updateManifestPath = path.join(channelDir, "updates.xml");

  return {
    channel,
    crxPath,
    zipPath,
    updateManifestPath,
    crxUrl: `/extensions/${channel}/umrah-extension.crx`,
    zipUrl: "/api/download/extension",
    directZipUrl: `/extensions/${channel}/umrah-extension.zip`,
    updateManifestUrl: `/extensions/${channel}/updates.xml`,
    hasCrx: existsSync(crxPath),
    hasZip: existsSync(zipPath),
    hasUpdateManifest: existsSync(updateManifestPath),
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
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
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

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => isTestEnv,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => isTestEnv,
});

const botLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => isTestEnv,
});

app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));
app.use("/extensions", express.static(path.join(__dirname, "public", "extensions"), {
  dotfiles: "deny",
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".crx")) {
      res.setHeader("Content-Type", "application/x-chrome-extension");
    }
    if (filePath.endsWith(".xml")) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
    }
  },
}));

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
    if (err) return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  });
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

const getVisibleRowForUser = (userId: number, rowId: string, includeDeleted = false) => {
  const record = db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
    .get(rowId) as LogisticsRowRecord | undefined;
  if (!record) return null;
  if (!includeDeleted && record.deleted_at) return null;
  return getRowScopeForUser(userId, record) ? record : null;
};

const decorateRowForUser = (record: LogisticsRowRecord, userId: number) => {
  const row = parseRowData(record.data);
  row._version = Number(record.version || 1);
  const access = getRowAccessForUser(userId, record);
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

const listVisibleRowsForUser = (userId: number, includeDeleted = false) => {
  const records = db
    .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows")
    .all() as LogisticsRowRecord[];
  return records
    .filter((record) => includeDeleted ? Boolean(record.deleted_at) : !record.deleted_at)
    .filter((record) => Boolean(getRowScopeForUser(userId, record)))
    .map((record) => decorateRowForUser(record, userId));
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

app.post("/api/auth/register", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-32 lowercase letters, numbers, underscores, or hyphens" });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 10-128 characters" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    const info = stmt.run(username, hashedPassword);

    const userId = Number(info.lastInsertRowid);
    const token = signAuthToken({ id: userId, username });
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
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body;
  if (!username || typeof password !== "string") return res.status(401).json({ error: "Invalid credentials" });
  const user: any = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signAuthToken({ id: Number(user.id), username: user.username });
  res.json({ token, user: { id: Number(user.id), username: user.username } });
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

  const insertStmt = db.prepare("INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)");
  const updateStmt = db.prepare("UPDATE logistics_rows SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  const affectedUserIds = new Set<number>();
  const conflicts: any[] = [];

  const sync = db.transaction((rows) => {
    for (const row of rows) {
      if (!row?.id) continue;
      const existing = db
        .prepare("SELECT id, user_id, data, version, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
        .get(row.id) as LogisticsRowRecord | undefined;

      const storedRow = sanitizeRowForStorage(row);
      if (existing) {
        const access = getRowAccessForUser(req.user.id, existing);
        if (access && canEditAccessRole(access.role) && !existing.deleted_at) {
          const current = parseRowData(existing.data);
          const next = { ...current, ...storedRow, id: current.id };
          if (row._version !== undefined && Number(row._version) !== Number(existing.version)) {
            if (JSON.stringify(next) !== JSON.stringify(current)) {
              conflicts.push({ id: existing.id, row: decorateRowForUser(existing, req.user.id) });
            }
            continue;
          }
          updateStmt.run(JSON.stringify(next), existing.id);
          getVisibleUserIdsForRowId(existing.id).forEach((id) => affectedUserIds.add(id));
        }
      } else {
        const groupNo = String(storedRow.groupNo || "").trim();
        const agency = normalizeAgency(storedRow.agency);
        if (groupNo) {
          const groupAccess = db
            .prepare("SELECT role FROM trip_group_access WHERE group_no = ? AND user_id = ?")
            .get(groupNo, req.user.id) as { role: ShareRole } | undefined;
          const agencyAccess = agency
            ? db
              .prepare("SELECT role FROM trip_agency_access WHERE agency = ? AND user_id = ?")
              .get(agency, req.user.id) as { role: ShareRole } | undefined
            : undefined;
          const hasReadonlySharedScope = [groupAccess, agencyAccess].some((access) => access && !canEditAccessRole(access.role));
          const hasEditableSharedScope = [groupAccess, agencyAccess].some((access) => access && canEditAccessRole(access.role));
          if (hasReadonlySharedScope && !hasEditableSharedScope) continue;
        } else if (agency) {
          const agencyAccess = db
            .prepare("SELECT role FROM trip_agency_access WHERE agency = ? AND user_id = ?")
            .get(agency, req.user.id) as { role: ShareRole } | undefined;
          if (agencyAccess && !canEditAccessRole(agencyAccess.role)) continue;
        }
        insertStmt.run(row.id, req.user.id, JSON.stringify(storedRow));
        const recipients = new Set<number>([req.user.id]);
        if (groupNo) getVisibleUserIdsForGroupNo(groupNo, req.user.id).forEach((id) => recipients.add(id));
        if (agency) getVisibleUserIdsForAgency(agency, req.user.id).forEach((id) => recipients.add(id));
        recipients.forEach((id) => affectedUserIds.add(id));
      }
    }
  });

  sync(rows);
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
  res.json({ success: true, row: decorateRowForUser(refreshed, req.user.id) });
});

app.post("/api/data/:id/delete", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, false);
  if (!visible) return res.status(404).json({ error: "Trip not found" });
  const access = getRowAccessForUser(req.user.id, visible);
  if (!canEditAccessRole(access?.role)) return res.status(403).json({ error: "Insufficient permission" });

  db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.user.id, visible.id);

  sendLiveEvent(getVisibleUserIdsForRowId(visible.id), "rows_changed", req.user.id);
  res.json({ success: true });
});

app.post("/api/data/:id/restore", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, true);
  if (!visible || !visible.deleted_at) return res.status(404).json({ error: "Trip not found" });
  const access = getRowAccessForUser(req.user.id, visible);
  if (!canEditAccessRole(access?.role)) return res.status(403).json({ error: "Insufficient permission" });

  db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = NULL, deleted_by_user_id = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(visible.id);

  sendLiveEvent(getVisibleUserIdsForRowId(visible.id), "rows_changed", req.user.id);
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

    db.prepare("UPDATE settings SET deleted_rows = ? WHERE user_id = ?").run("[]", req.user.id);
  });

  deleteRows(records);
  sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
  res.json({ success: true, deletedCount: records.length });
});

app.delete("/api/data/:id", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, true);
  if (!visible || !visible.deleted_at) return res.status(404).json({ error: "Trip not found" });
  if (Number(visible.user_id) !== Number(req.user.id)) return res.status(403).json({ error: "Only the owner can permanently delete a trip" });

  const affectedUserIds = getVisibleUserIdsForRowRecord(visible);
  db.transaction(() => {
    db.prepare("DELETE FROM trip_row_access WHERE row_id = ?").run(visible.id);
    db.prepare("DELETE FROM trip_share_invitations WHERE row_id = ?").run(visible.id);
    db.prepare("DELETE FROM logistics_rows WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL").run(visible.id, req.user.id);
    db.prepare("UPDATE settings SET deleted_rows = ? WHERE user_id = ?").run("[]", req.user.id);
  })();

  sendLiveEvent(affectedUserIds, "rows_changed", req.user.id);
  res.json({ success: true });
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

  res.json({ success: true });
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
  const { groupNo } = req.params;

  const rawRows = db
    .prepare("SELECT data FROM logistics_rows WHERE user_id = ?")
    .all(req.user.id) as { data: string }[];

  const matches = rawRows.filter(({ data }) => {
    try { return JSON.parse(data).groupNo === groupNo; } catch { return false; }
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
    const newRows = parseItineraryText(textValue, {
      groupNo: groupNoValue,
      groupName: groupNameValue,
      agency: agencyValue,
      count: countValue,
    });

    if (newRows.length === 0)
      return res.status(422).json({ error: "لم يتم استخراج أي رحلات من النص", rows: [] });

    const existingRaw = db
      .prepare("SELECT data FROM logistics_rows WHERE user_id = ? AND deleted_at IS NULL")
      .all(req.user.id) as { data: string }[];

    let existingRows = existingRaw.map((r) => JSON.parse(r.data));

    if (overwrite) {
      existingRows = existingRows.filter((r) => r.groupNo !== groupNoValue);
    }

    const mergedRows = [...newRows, ...existingRows];

    const deleteStmt = db.prepare("DELETE FROM logistics_rows WHERE user_id = ? AND deleted_at IS NULL");
    const insertStmt = db.prepare("INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)");

    db.transaction((rows: any[]) => {
      deleteStmt.run(req.user.id);
      for (const row of rows) insertStmt.run(row.id, req.user.id, JSON.stringify(row));
    })(mergedRows);

    const affectedUserIds = new Set<number>([req.user.id]);
    newRows.forEach((row: any) => {
      const rowGroupNo = String(row.groupNo || "").trim();
      const rowAgency = normalizeAgency(row.agency);
      if (rowGroupNo) getVisibleUserIdsForGroupNo(rowGroupNo, req.user.id).forEach((id) => affectedUserIds.add(id));
      if (rowAgency) getVisibleUserIdsForAgency(rowAgency, req.user.id).forEach((id) => affectedUserIds.add(id));
    });
    sendLiveEvent(affectedUserIds, "rows_changed");

    const action = overwrite ? "استبدال" : "إضافة";
    console.log(`[Ingest] ${action} ${newRows.length} rows for group ${groupNo} (user ${req.user.id})`);

    res.json({ success: true, rows: newRows, message: `تم ${action} ${newRows.length} رحلة` });

  } catch (err: any) {
    console.error("[Ingest] Error:", err);
    res.status(500).json({ error: "خطأ في معالجة النص: " + err.message });
  }
});

// GET /api/download/extension — serve Chrome extension zip (public, no auth required)
app.get("/api/extension/info", (_req, res) => {
  res.json(getExtensionInfo());
});

app.get("/api/download/extension/crx", (_req, res) => {
  const info = getExtensionInfo();
  if (info.hasCrx) {
    res.redirect(info.crxUrl);
    return;
  }
  res.status(404).json({ error: "ملف الإضافة غير موجود" });
});

app.get("/api/download/extension/zip", (_req, res) => {
  const info = getExtensionInfo();
  if (info.hasZip) {
    res.redirect(info.directZipUrl);
    return;
  }
  const legacyZipPath = path.join(__dirname, "chrome extention", "umrah-extension.zip");
  const fallbackZipPath = path.join(APP_ROOT, "chrome extention", "umrah-extension.zip");
  res.download(existsSync(fallbackZipPath) ? fallbackZipPath : legacyZipPath, "umrah-extension.zip", (err) => {
    if (err) res.status(404).json({ error: "الملف غير موجود" });
  });
});

app.get("/api/download/extension", (_req, res) => {
  const info = getExtensionInfo();
  if (info.hasZip) {
    res.redirect(info.directZipUrl);
    return;
  }
  const legacyZipPath = path.join(__dirname, "chrome extention", "umrah-extension.zip");
  const fallbackZipPath = path.join(APP_ROOT, "chrome extention", "umrah-extension.zip");
  res.download(existsSync(fallbackZipPath) ? fallbackZipPath : legacyZipPath, "umrah-extension.zip", (err) => {
    if (err) res.status(404).json({ error: "الملف غير موجود" });
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

export { app, attachLiveUpdates };

if (!isTestEnv) {
  const server = http.createServer(app);
  attachLiveUpdates(server);

  // Start alert worker immediately then every 60 s
  checkAndSendAlerts();
  setInterval(checkAndSendAlerts, 60_000);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`[Alerts] Proximity alert worker started (60 s interval)`);
  });
}
