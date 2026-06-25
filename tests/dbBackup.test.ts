import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupDatabase, restoreDatabase } from "../scripts/db-backup.mjs";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "umrah-backup-"));

describe("database backups", () => {
  it("creates a consistent sqlite snapshot", async () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "live.db");
    const backupDir = path.join(dir, "backups");

    const db = new Database(dbPath);
    db.exec("create table items (id integer primary key, name text not null)");
    db.prepare("insert into items (name) values (?)").run("first");
    db.close();

    const snapshotPath = await backupDatabase({ dbPath, backupDir, keep: 3 });

    const live = new Database(dbPath);
    live.prepare("insert into items (name) values (?)").run("second");
    live.close();

    const snapshot = new Database(snapshotPath, { readonly: true });
    expect(snapshot.prepare("select name from items order by id").all()).toEqual([{ name: "first" }]);
    snapshot.close();
  });

  it("restores a backup over the live database", async () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "live.db");
    const backupDir = path.join(dir, "backups");

    const db = new Database(dbPath);
    db.exec("create table items (id integer primary key, name text not null)");
    db.prepare("insert into items (name) values (?)").run("before");
    db.close();

    const snapshotPath = await backupDatabase({ dbPath, backupDir, keep: 3 });

    const live = new Database(dbPath);
    live.exec("delete from items");
    live.prepare("insert into items (name) values (?)").run("after");
    live.close();

    await restoreDatabase({ dbPath, backupPath: snapshotPath });

    const restored = new Database(dbPath, { readonly: true });
    expect(restored.prepare("select name from items order by id").all()).toEqual([{ name: "before" }]);
    restored.close();
  });
});
