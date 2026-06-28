import { describe, expect, it } from "vitest";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");

describe("deploy workflow database handling", () => {
  it("runs production and staging with databases outside the git checkout", () => {
    expect(workflow).toContain("deploy_app /var/www/umrah-prod main umrah-prod /var/lib/umrah/prod/umrah.db");
    expect(workflow).toContain("deploy_app /var/www/umrah-staging staging umrah-staging /var/lib/umrah/staging/umrah.db");
    expect(workflow).toContain('DB_PATH="$APP_DB_PATH" EXTENSION_CHANNEL="$EXTENSION_ENV" pm2 restart');
    expect(workflow).toContain('DB_PATH="$APP_DB_PATH" EXTENSION_CHANNEL="$EXTENSION_ENV" pm2 start');
    expect(workflow).toContain("0 * * * * root cd /var/www/umrah-prod &&");
    expect(workflow).toContain("0 * * * * root cd /var/www/umrah-staging &&");
    expect(workflow).toContain('"$NODE_BIN" scripts/db-backup.mjs backup --db /var/lib/umrah/prod/umrah.db --dir /var/backups/umrah/prod --keep 168');
  });

  it("migrates an existing in-repo database before resetting the checkout", () => {
    const migrateIndex = workflow.indexOf("migrate_existing_db");
    const resetIndex = workflow.indexOf("git reset --hard");

    expect(migrateIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeLessThan(resetIndex);
  });

  it("packages the extension for both production and staging", () => {
    expect(workflow).toContain("scripts/package-extension.mjs");
    expect(workflow).toContain('--env "$EXTENSION_ENV"');
    expect(workflow).toContain('--out "$APP_DIR/public/extensions/$EXTENSION_ENV"');
    expect(workflow).toContain("EXTENSION_PEM_PATH");
    expect(workflow).toContain('deploy_app /var/www/umrah-prod main umrah-prod /var/lib/umrah/prod/umrah.db prod "$PROD_EXTENSION_BASE_URL" "$PROD_EXTENSION_PEM_PATH"');
    expect(workflow).toContain('deploy_app /var/www/umrah-staging staging umrah-staging /var/lib/umrah/staging/umrah.db staging "$STAGING_EXTENSION_BASE_URL" "$STAGING_EXTENSION_PEM_PATH"');
  });
});
