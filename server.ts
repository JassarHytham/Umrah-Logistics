import express from "express";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { parseDateTime, parseItineraryText, getCarType } from "./utils/parser.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || "umrah-secret-key-2026";
const liveClients = new Map<number, Set<any>>();

// Database initialization
const DB_PATH = process.env.VITEST ? ":memory:" : (process.env.DB_PATH || "umrah.db");
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (row_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (granted_by_user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS trip_group_access (
    group_no TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    granted_by_user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_no, user_id),
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (granted_by_user_id) REFERENCES users (id)
  );
`);

// Migration: Add shared recycle-bin columns if missing
try {
  db.prepare("SELECT deleted_at, deleted_by_user_id FROM logistics_rows LIMIT 1").get();
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

type LogisticsRowRecord = {
  id: string;
  user_id: number;
  data: string;
  updated_at?: string;
  deleted_at?: string | null;
  deleted_by_user_id?: number | null;
};

const parseRowData = (data: string) => JSON.parse(data);

const sanitizeRowForStorage = (row: any) => {
  const { _sharing, _originalIndex, ...stored } = row;
  return stored;
};

const getUsernameById = (id: number | null | undefined) => {
  if (!id) return null;
  const user: any = db.prepare("SELECT username FROM users WHERE id = ?").get(id);
  return user?.username ?? null;
};

const getUserByUsername = (username: string) =>
  db.prepare("SELECT id, username FROM users WHERE username = ?").get(username) as { id: number; username: string } | undefined;

const getRowScopeForUser = (userId: number, record: LogisticsRowRecord): "owner" | "row" | "group" | null => {
  if (Number(record.user_id) === Number(userId)) return "owner";

  const rowAccess = db
    .prepare("SELECT 1 FROM trip_row_access WHERE row_id = ? AND user_id = ?")
    .get(record.id, userId);
  if (rowAccess) return "row";

  const row = parseRowData(record.data);
  if (row.groupNo) {
    const groupAccess = db
      .prepare("SELECT 1 FROM trip_group_access WHERE group_no = ? AND user_id = ?")
      .get(String(row.groupNo), userId);
    if (groupAccess) return "group";
  }

  return null;
};

const getVisibleRowForUser = (userId: number, rowId: string, includeDeleted = false) => {
  const record = db
    .prepare("SELECT id, user_id, data, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
    .get(rowId) as LogisticsRowRecord | undefined;
  if (!record) return null;
  if (!includeDeleted && record.deleted_at) return null;
  return getRowScopeForUser(userId, record) ? record : null;
};

const decorateRowForUser = (record: LogisticsRowRecord, userId: number) => {
  const row = parseRowData(record.data);
  const scope = getRowScopeForUser(userId, record);
  const isShared = Boolean(scope && scope !== "owner");
  if (isShared || record.deleted_at) {
    row._sharing = {
      shared: isShared,
      ownerUsername: getUsernameById(record.user_id),
      ...(scope && scope !== "owner" ? { scope } : {}),
      ...(record.deleted_at ? { deletedAt: record.deleted_at, deletedByUsername: getUsernameById(record.deleted_by_user_id) } : {}),
    };
  }
  return row;
};

const listVisibleRowsForUser = (userId: number, includeDeleted = false) => {
  const records = db
    .prepare("SELECT id, user_id, data, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows")
    .all() as LogisticsRowRecord[];
  return records
    .filter((record) => includeDeleted ? Boolean(record.deleted_at) : !record.deleted_at)
    .filter((record) => Boolean(getRowScopeForUser(userId, record)))
    .map((record) => decorateRowForUser(record, userId));
};

type LiveEventType = "rows_changed" | "invitations_changed";

const sendLiveEvent = (userIds: Iterable<number>, type: LiveEventType) => {
  const payload = JSON.stringify({ type, at: new Date().toISOString() });
  for (const id of new Set(Array.from(userIds).map(Number))) {
    const clients = liveClients.get(id);
    if (!clients) continue;
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }
};

const getVisibleUserIdsForRowRecord = (record: LogisticsRowRecord) => {
  const userIds = new Set<number>([Number(record.user_id)]);
  const rowAccess = db.prepare("SELECT user_id FROM trip_row_access WHERE row_id = ?").all(record.id) as { user_id: number }[];
  rowAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));

  const row = parseRowData(record.data);
  if (row.groupNo) {
    const groupAccess = db.prepare("SELECT user_id FROM trip_group_access WHERE group_no = ?").all(String(row.groupNo)) as { user_id: number }[];
    groupAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));
  }
  return userIds;
};

const getVisibleUserIdsForRowId = (rowId: string) => {
  const record = db
    .prepare("SELECT id, user_id, data, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
    .get(rowId) as LogisticsRowRecord | undefined;
  return record ? getVisibleUserIdsForRowRecord(record) : new Set<number>();
};

const getVisibleUserIdsForGroupNo = (groupNo: string, ownerUserId: number) => {
  const userIds = new Set<number>([Number(ownerUserId)]);
  const groupAccess = db.prepare("SELECT user_id FROM trip_group_access WHERE group_no = ?").all(groupNo) as { user_id: number }[];
  groupAccess.forEach(({ user_id }) => userIds.add(Number(user_id)));
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
      const user = jwt.verify(token, JWT_SECRET) as { id: number; username: string };
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
  res.json(listVisibleRowsForUser(req.user.id, false));
});

app.get("/api/data/deleted", authenticateToken, (req: any, res) => {
  res.json(listVisibleRowsForUser(req.user.id, true));
});

app.post("/api/data/sync", authenticateToken, (req: any, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Invalid data" });

  const insertStmt = db.prepare("INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)");
  const updateStmt = db.prepare("UPDATE logistics_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  const affectedUserIds = new Set<number>();

  const sync = db.transaction((rows) => {
    for (const row of rows) {
      if (!row?.id) continue;
      const existing = db
        .prepare("SELECT id, user_id, data, updated_at, deleted_at, deleted_by_user_id FROM logistics_rows WHERE id = ?")
        .get(row.id) as LogisticsRowRecord | undefined;

      const storedRow = sanitizeRowForStorage(row);
      if (existing) {
        if (getRowScopeForUser(req.user.id, existing) && !existing.deleted_at) {
          const current = parseRowData(existing.data);
          updateStmt.run(JSON.stringify({ ...current, ...storedRow, id: current.id }), existing.id);
          getVisibleUserIdsForRowId(existing.id).forEach((id) => affectedUserIds.add(id));
        }
      } else {
        insertStmt.run(row.id, req.user.id, JSON.stringify(storedRow));
        const groupNo = String(storedRow.groupNo || "").trim();
        const recipients = groupNo ? getVisibleUserIdsForGroupNo(groupNo, req.user.id) : new Set<number>([req.user.id]);
        recipients.forEach((id) => affectedUserIds.add(id));
      }
    }
  });

  sync(rows);
  sendLiveEvent(affectedUserIds, "rows_changed");
  res.json({ success: true });
});

app.patch("/api/data/:id", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, false);
  if (!visible) return res.status(404).json({ error: "Trip not found" });

  const updates = req.body?.updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return res.status(400).json({ error: "Invalid updates" });
  }

  const current = parseRowData(visible.data);
  const updated = sanitizeRowForStorage({ ...current, ...updates, id: current.id });
  db.prepare("UPDATE logistics_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(JSON.stringify(updated), visible.id);

  const refreshed = getVisibleRowForUser(req.user.id, visible.id, false) as LogisticsRowRecord;
  sendLiveEvent(getVisibleUserIdsForRowRecord(refreshed), "rows_changed");
  res.json({ success: true, row: decorateRowForUser(refreshed, req.user.id) });
});

app.post("/api/data/:id/delete", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, false);
  if (!visible) return res.status(404).json({ error: "Trip not found" });

  db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.user.id, visible.id);

  sendLiveEvent(getVisibleUserIdsForRowId(visible.id), "rows_changed");
  res.json({ success: true });
});

app.post("/api/data/:id/restore", authenticateToken, (req: any, res) => {
  const visible = getVisibleRowForUser(req.user.id, req.params.id, true);
  if (!visible || !visible.deleted_at) return res.status(404).json({ error: "Trip not found" });

  db.prepare(`
    UPDATE logistics_rows
    SET deleted_at = NULL, deleted_by_user_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(visible.id);

  sendLiveEvent(getVisibleUserIdsForRowId(visible.id), "rows_changed");
  res.json({ success: true });
});

// Sharing Routes
app.post("/api/shares/invitations", authenticateToken, (req: any, res) => {
  const { receiverUsername, scopeType, rowId, groupNo } = req.body;
  if (!receiverUsername || !scopeType) return res.status(400).json({ error: "Receiver and scope required" });
  if (!["row", "group"].includes(scopeType)) return res.status(400).json({ error: "Invalid share scope" });

  const receiver = getUserByUsername(String(receiverUsername).trim());
  if (!receiver) return res.status(404).json({ error: "Receiver account not found" });
  if (Number(receiver.id) === Number(req.user.id)) return res.status(400).json({ error: "Cannot share with yourself" });

  let normalizedRowId: string | null = null;
  let normalizedGroupNo: string | null = null;

  if (scopeType === "row") {
    if (!rowId) return res.status(400).json({ error: "rowId is required" });
    const visible = getVisibleRowForUser(req.user.id, String(rowId), true);
    if (!visible) return res.status(404).json({ error: "Trip not found" });
    normalizedRowId = String(rowId);
  } else {
    if (!groupNo) return res.status(400).json({ error: "groupNo is required" });
    normalizedGroupNo = String(groupNo).trim();
    const canShareGroup = listVisibleRowsForUser(req.user.id, false)
      .some((row: any) => String(row.groupNo || "").trim() === normalizedGroupNo);
    const hasGroupAccess = db
      .prepare("SELECT 1 FROM trip_group_access WHERE group_no = ? AND user_id = ?")
      .get(normalizedGroupNo, req.user.id);
    if (!canShareGroup && !hasGroupAccess) return res.status(404).json({ error: "Group not found" });
  }

  const existingAccess = scopeType === "row"
    ? db.prepare("SELECT 1 FROM trip_row_access WHERE row_id = ? AND user_id = ?").get(normalizedRowId, receiver.id)
    : db.prepare("SELECT 1 FROM trip_group_access WHERE group_no = ? AND user_id = ?").get(normalizedGroupNo, receiver.id);
  if (existingAccess) return res.status(400).json({ error: "User already has access" });

  const existingInvite: any = db.prepare(`
    SELECT * FROM trip_share_invitations
    WHERE receiver_user_id = ?
      AND scope_type = ?
      AND COALESCE(row_id, '') = COALESCE(?, '')
      AND COALESCE(group_no, '') = COALESCE(?, '')
      AND status = 'pending'
  `).get(receiver.id, scopeType, normalizedRowId, normalizedGroupNo);
  if (existingInvite) {
    return res.json({
      success: true,
      invitation: {
        id: existingInvite.id,
        scopeType: existingInvite.scope_type,
        rowId: existingInvite.row_id,
        groupNo: existingInvite.group_no,
      },
    });
  }

  const info = db.prepare(`
    INSERT INTO trip_share_invitations (sender_user_id, receiver_user_id, scope_type, row_id, group_no)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, receiver.id, scopeType, normalizedRowId, normalizedGroupNo);

  sendLiveEvent([receiver.id], "invitations_changed");

  res.json({
    success: true,
    invitation: {
      id: Number(info.lastInsertRowid),
      senderUsername: req.user.username,
      receiverUsername: receiver.username,
      scopeType,
      rowId: normalizedRowId,
      groupNo: normalizedGroupNo,
    },
  });
});

app.get("/api/shares/invitations", authenticateToken, (req: any, res) => {
  const invitations = db.prepare(`
    SELECT i.id, i.scope_type, i.row_id, i.group_no, i.created_at, u.username AS sender_username
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
    createdAt: invite.created_at,
  })));
});

app.post("/api/shares/invitations/:id/accept", authenticateToken, (req: any, res) => {
  const invitation: any = db.prepare(`
    SELECT * FROM trip_share_invitations
    WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
  `).get(req.params.id, req.user.id);
  if (!invitation) return res.status(404).json({ error: "Invitation not found" });

  if (invitation.scope_type === "row") {
    db.prepare(`
      INSERT OR IGNORE INTO trip_row_access (row_id, user_id, granted_by_user_id)
      VALUES (?, ?, ?)
    `).run(invitation.row_id, req.user.id, invitation.sender_user_id);
  } else {
    const insertGroupAccess = db.prepare(`
      INSERT OR IGNORE INTO trip_group_access (group_no, user_id, granted_by_user_id)
      VALUES (?, ?, ?)
    `);
    insertGroupAccess.run(invitation.group_no, invitation.sender_user_id, invitation.sender_user_id);
    insertGroupAccess.run(invitation.group_no, req.user.id, invitation.sender_user_id);
  }

  db.prepare(`
    UPDATE trip_share_invitations
    SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(invitation.id);

  sendLiveEvent([invitation.sender_user_id, req.user.id], "invitations_changed");
  if (invitation.scope_type === "row") {
    sendLiveEvent(getVisibleUserIdsForRowId(invitation.row_id), "rows_changed");
  } else {
    sendLiveEvent(getVisibleUserIdsForGroupNo(invitation.group_no, invitation.sender_user_id), "rows_changed");
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

  sendLiveEvent([invitation.sender_user_id, req.user.id], "invitations_changed");
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
    fontSize: settings.font_size || 100,
    ...(settings.extra_settings ? JSON.parse(settings.extra_settings) : {})
  });
});

app.post("/api/settings", authenticateToken, (req: any, res) => {
  const { tgConfig, templates, deletedRows, notifiedIds, fontSize, alertSettings, previewSettings, displaySettings } = req.body;

  // Merge with existing settings so partial saves never wipe unrelated fields
  const existing: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);

  const merged = {
    tg_config: tgConfig !== undefined ? (tgConfig ? JSON.stringify(tgConfig) : null)
      : (existing?.tg_config ?? null),
    templates: templates !== undefined ? (templates ? JSON.stringify(templates) : null)
      : (existing?.templates ?? null),
    deleted_rows: deletedRows !== undefined ? (deletedRows ? JSON.stringify(deletedRows) : null)
      : (existing?.deleted_rows ?? null),
    notified_ids: existing?.notified_ids ?? null,
    font_size: fontSize !== undefined ? fontSize : (existing?.font_size ?? 100),
    extra_settings: JSON.stringify({
      alertSettings: alertSettings !== undefined ? alertSettings : (existing?.extra_settings ? JSON.parse(existing.extra_settings).alertSettings : undefined),
      previewSettings: previewSettings !== undefined ? previewSettings : (existing?.extra_settings ? JSON.parse(existing.extra_settings).previewSettings : undefined),
      displaySettings: displaySettings !== undefined ? displaySettings : (existing?.extra_settings ? JSON.parse(existing.extra_settings).displaySettings : undefined),
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

// Debug endpoint — shows what the alert worker sees for the logged-in user
app.get("/api/alerts/debug", authenticateToken, (req: any, res) => {
  const now = new Date();
  const settings: any = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);

  const tgConfig = settings?.tg_config ? JSON.parse(settings.tg_config) : null;
  const extraSettings = settings?.extra_settings ? JSON.parse(settings.extra_settings) : {};
  const alertSettings = extraSettings.alertSettings ?? {
    arrivalMinutes: 120,
    departureMinutes: 60,
    messageFields: { flight: true, carType: true, count: false, tafweej: false },
  };
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
// Body: { text, groupNo, groupName, count, overwrite? }
app.post("/api/ingest/text", authenticateToken, (req: any, res) => {
  const { text, groupNo, groupName, count, overwrite = false } = req.body;

  if (!text || typeof text !== "string" || text.trim().length < 5)
    return res.status(400).json({ error: "النص مطلوب ولا يمكن أن يكون فارغاً" });
  if (!groupNo || !groupName || !count)
    return res.status(400).json({ error: "بيانات المجموعة مطلوبة (رقم، اسم، عدد)" });

  try {
    const newRows = parseItineraryText(text.trim(), {
      groupNo: String(groupNo).trim(),
      groupName: String(groupName).trim(),
      count: String(count).trim(),
    });

    if (newRows.length === 0)
      return res.status(422).json({ error: "لم يتم استخراج أي رحلات من النص", rows: [] });

    const existingRaw = db
      .prepare("SELECT data FROM logistics_rows WHERE user_id = ?")
      .all(req.user.id) as { data: string }[];

    let existingRows = existingRaw.map((r) => JSON.parse(r.data));

    if (overwrite) {
      existingRows = existingRows.filter((r) => r.groupNo !== String(groupNo).trim());
    }

    const mergedRows = [...newRows, ...existingRows];

    const deleteStmt = db.prepare("DELETE FROM logistics_rows WHERE user_id = ?");
    const insertStmt = db.prepare("INSERT INTO logistics_rows (id, user_id, data) VALUES (?, ?, ?)");

    db.transaction((rows: any[]) => {
      deleteStmt.run(req.user.id);
      for (const row of rows) insertStmt.run(row.id, req.user.id, JSON.stringify(row));
    })(mergedRows);

    const affectedUserIds = new Set<number>([req.user.id]);
    newRows.forEach((row: any) => {
      const rowGroupNo = String(row.groupNo || "").trim();
      if (rowGroupNo) getVisibleUserIdsForGroupNo(rowGroupNo, req.user.id).forEach((id) => affectedUserIds.add(id));
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
app.get("/api/download/extension", (_req, res) => {
  const zipPath = path.join(__dirname, "chrome extention", "umrah-extension.zip");
  res.download(zipPath, "umrah-extension.zip", (err) => {
    if (err) res.status(404).json({ error: "الملف غير موجود" });
  });
});

// Vite middleware for development
if (!["production", "staging"].includes(process.env.NODE_ENV || "") && !process.env.VITEST) {
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

export { app, attachLiveUpdates };

if (!process.env.VITEST) {
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
