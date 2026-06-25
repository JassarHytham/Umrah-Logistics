import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_KEEP = 168;
const BACKUP_PREFIX = "umrah";

const timestampForFile = (date = new Date()) =>
  date.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "Z");

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const backupFileName = (dbPath, date = new Date()) => {
  const base = path.basename(dbPath, path.extname(dbPath)) || BACKUP_PREFIX;
  return `${base}-${timestampForFile(date)}.db`;
};

const listBackupFiles = async (backupDir, dbPath) => {
  const base = path.basename(dbPath, path.extname(dbPath)) || BACKUP_PREFIX;
  const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith(`${base}-`) || !entry.name.endsWith(".db")) continue;
    const filePath = path.join(backupDir, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat) files.push({ filePath, mtimeMs: stat.mtimeMs });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
};

export const backupDatabase = async ({ dbPath, backupDir, keep = DEFAULT_KEEP }) => {
  if (!dbPath) throw new Error("dbPath is required");
  if (!backupDir) throw new Error("backupDir is required");

  await ensureDir(backupDir);

  const destination = path.join(backupDir, backupFileName(dbPath));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    await db.backup(destination);
  } finally {
    db.close();
  }

  const backups = await listBackupFiles(backupDir, dbPath);
  const stale = backups.slice(Math.max(keep, 0));
  await Promise.all(stale.map(({ filePath }) => fs.unlink(filePath).catch(() => {})));

  return destination;
};

export const restoreDatabase = async ({ dbPath, backupPath }) => {
  if (!dbPath) throw new Error("dbPath is required");
  if (!backupPath) throw new Error("backupPath is required");

  const dbDir = path.dirname(dbPath);
  await ensureDir(dbDir);

  const currentExists = await fs.access(dbPath).then(() => true).catch(() => false);
  if (currentExists) {
    const safetyPath = path.join(dbDir, `${path.basename(dbPath, path.extname(dbPath))}.pre-restore-${timestampForFile()}.db`);
    await fs.copyFile(dbPath, safetyPath);
  }

  const tempPath = path.join(dbDir, `${path.basename(dbPath)}.restore-${process.pid}-${Date.now()}.tmp`);
  await fs.copyFile(backupPath, tempPath);
  await fs.rename(tempPath, dbPath);
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [flag, inlineValue] = token.split("=", 2);
    const key = flag.slice(2);
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined && value !== undefined && !String(value).startsWith("--")) {
      i += 1;
      args[key] = value;
    } else if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const runCli = async () => {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "backup";

  if (command === "backup") {
    const dbPath = args.db || process.env.DB_PATH || "umrah.db";
    const backupDir = args.dir || process.env.DB_BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
    const keep = Number.parseInt(args.keep || process.env.DB_BACKUP_KEEP || String(DEFAULT_KEEP), 10);
    const snapshot = await backupDatabase({ dbPath, backupDir, keep: Number.isFinite(keep) ? keep : DEFAULT_KEEP });
    process.stdout.write(`${snapshot}\n`);
    return;
  }

  if (command === "restore") {
    const dbPath = args.db || process.env.DB_PATH || "umrah.db";
    const backupPath = args.backup || args.from;
    if (!backupPath) {
      throw new Error("backup path is required");
    }
    await restoreDatabase({ dbPath, backupPath });
    process.stdout.write(`${dbPath}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
