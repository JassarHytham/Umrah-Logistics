import { describe, expect, it } from "vitest";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");

describe("deploy workflow database handling", () => {
  it("runs production and staging with databases outside the git checkout", () => {
    expect(workflow).toContain("deploy_app /var/www/umrah-prod main umrah-prod /var/lib/umrah/prod/umrah.db");
    expect(workflow).toContain("deploy_app /var/www/umrah-staging staging umrah-staging /var/lib/umrah/staging/umrah.db");
    expect(workflow).toContain('DB_PATH="$APP_DB_PATH" pm2 restart');
    expect(workflow).toContain('DB_PATH="$APP_DB_PATH" pm2 start');
  });

  it("migrates an existing in-repo database before resetting the checkout", () => {
    const migrateIndex = workflow.indexOf("migrate_existing_db");
    const resetIndex = workflow.indexOf("git reset --hard");

    expect(migrateIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeLessThan(resetIndex);
  });
});
