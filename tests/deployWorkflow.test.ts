import { describe, expect, it } from "vitest";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");

describe("deploy workflow database handling", () => {
  it("runs production and staging with databases outside the git checkout", () => {
    expect(workflow).toContain("deploy_app /var/www/umrah-prod main umrah-prod /var/lib/umrah/prod/umrah.db");
    expect(workflow).toContain("deploy_app /var/www/umrah-staging staging umrah-staging /var/lib/umrah/staging/umrah.db");
    expect(workflow).toContain("run_backup_tasks /var/www/umrah-prod /var/lib/umrah/prod/umrah.db /var/backups/umrah/prod");
    expect(workflow).toContain("run_backup_tasks /var/www/umrah-staging /var/lib/umrah/staging/umrah.db /var/backups/umrah/staging");
    expect(workflow).toContain('DB_PATH="$APP_DB_PATH" pm2 restart');
    expect(workflow).toContain('DB_PATH="$APP_DB_PATH" pm2 start');
    expect(workflow).toContain("0 * * * * root cd /var/www/umrah-prod &&");
    expect(workflow).toContain("0 * * * * root cd /var/www/umrah-staging &&");
    expect(workflow).toContain('"$NODE_BIN" scripts/db-backup.mjs backup --db "$DB_PATH_TO_BACKUP" --dir "$BACKUP_DIR" --keep 168');
  });

  it("migrates an existing in-repo database before resetting the checkout", () => {
    const migrateIndex = workflow.indexOf("migrate_existing_db");
    const resetIndex = workflow.indexOf("git reset --hard");

    expect(migrateIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeLessThan(resetIndex);
  });

  it("does not require root privileges to complete deployment", () => {
    expect(workflow).toContain("run_backup_tasks()");
    expect(workflow).toContain('echo "Skipping backup setup: deploy user is not root."');
    expect(workflow).toContain("install_backup_cron");
    expect(workflow).toContain('"$NODE_BIN" scripts/db-backup.mjs backup --db "$DB_PATH_TO_BACKUP" --dir "$BACKUP_DIR" --keep 168');
  });

  it("writes the cron file without a shell heredoc", () => {
    expect(workflow).toContain("printf '%s\\n'");
    expect(workflow).not.toContain("<<EOF");
  });
});
