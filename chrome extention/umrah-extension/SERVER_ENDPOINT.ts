// ─────────────────────────────────────────────────────────────────────────────
// ADD THESE TWO THINGS TO server.ts
//
// 1. Update the import at the top:
//    FROM: import { parseDateTime } from "./utils/parser.js";
//    TO:   import { parseDateTime, parseItineraryText } from "./utils/parser.js";
//
// 2. Paste BOTH endpoints below before the Vite middleware block.
// ─────────────────────────────────────────────────────────────────────────────


// ── 1. Check if a group number already has rows ───────────────────────────────
// Used by the browser extension before sending, to detect duplicates.
// GET /api/check/group/:groupNo
// Returns: { exists: boolean, count: number }
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


// ── 2. Ingest text from the browser extension ─────────────────────────────────
// POST /api/ingest/text
// Body: { text, groupNo, groupName, count, overwrite? }
//   overwrite=true  → delete all existing rows for this groupNo first
//   overwrite=false → prepend new rows (default)
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

    // Fetch existing rows for this user
    const existingRaw = db
      .prepare("SELECT data FROM logistics_rows WHERE user_id = ?")
      .all(req.user.id) as { data: string }[];

    let existingRows = existingRaw.map((r) => JSON.parse(r.data));

    // If overwrite: remove all rows belonging to this groupNo
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

    const action = overwrite ? "استبدال" : "إضافة";
    console.log(`[Ingest] ${action} ${newRows.length} rows for group ${groupNo} (user ${req.user.id})`);

    res.json({ success: true, rows: newRows, message: `تم ${action} ${newRows.length} رحلة` });

  } catch (err: any) {
    console.error("[Ingest] Error:", err);
    res.status(500).json({ error: "خطأ في معالجة النص: " + err.message });
  }
});
