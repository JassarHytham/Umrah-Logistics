import type { Database } from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { migrateSubscriptionSchema } from './subscriptions';

type MigrationOptions = { orphanTripAssignment?: { companyName:string; expectedTripCount:number } };

const companySharingMigration=(db:Database)=>{
  if(!(db.pragma('table_info(companies)') as {name:string}[]).some(column=>column.name==='share_all_trips'))
    db.exec('ALTER TABLE companies ADD COLUMN share_all_trips INTEGER NOT NULL DEFAULT 1 CHECK(share_all_trips IN (0,1))');
  db.exec('CREATE INDEX IF NOT EXISTS logistics_workspace_creator_deleted ON logistics_rows(workspace_id,user_id,deleted_at)');
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (4)').run();
};

const archiveMarkerMigration = (db:Database) => {
  const columns=db.pragma('table_info(users)') as {name:string}[];
  if(!columns.some(column=>column.name==='is_archived_creator')) {
    db.exec('ALTER TABLE users ADD COLUMN is_archived_creator INTEGER NOT NULL DEFAULT 0 CHECK(is_archived_creator IN (0,1))');
  }
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)').run();
};

export const workspaceFeatureEnabled = (env: NodeJS.ProcessEnv) =>
  ((env.UMRAH_DEPLOYMENT_ENV === 'staging' || env.NODE_ENV === 'staging') && env.STAGING_WORKSPACES_ENABLED !== 'false')
  || (env.NODE_ENV === 'test' && env.WORKSPACE_TEST_MODE === 'true');

export const hasWorkspaceSchema = (db: Database) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_memberships'",
).get());

export const workspaceMigrationRequired = (db:Database) => !hasWorkspaceSchema(db)
  || ((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {version:number|null}).version??0)<4;

// Staging rehearsal only. Existing authoritative company IDs are preserved;
// unassigned accounts receive individual workspaces, never name-based grouping.
export function migrateStagingWorkspaces(db: Database, options:MigrationOptions={}) {
  if (hasWorkspaceSchema(db)) {
    db.pragma('foreign_keys = ON');
    db.transaction(()=>{archiveMarkerMigration(db);migrateSubscriptionSchema(db);companySharingMigration(db);})();
    return;
  }
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const preservedColumns=(db.pragma('table_info(logistics_rows)') as {name:string}[])
        .filter(column=>column.name!=='workspace_id').map(column=>`"${column.name.replace(/"/g,'""')}"`).join(',');
      const historicTripsQuery=`SELECT ${preservedColumns} FROM logistics_rows ORDER BY id`;
      const historicTrips=JSON.stringify(db.prepare(historicTripsQuery).all());
      // Only company references valid before allocation are authoritative.
      const originalCompanyIds=new Set((db.prepare('SELECT id FROM companies').all() as {id:number}[]).map(company=>company.id));
      const recoveredCreatorWorkspaces=new Map<number,number>();
      db.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE workspace_memberships (
          workspace_id INTEGER NOT NULL REFERENCES companies(id),
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
          role TEXT NOT NULL CHECK(role IN ('owner','manager','editor','viewer')),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id,user_id)
        );
        CREATE UNIQUE INDEX workspace_one_owner ON workspace_memberships(workspace_id) WHERE role='owner';
        CREATE TABLE workspace_settings (
          workspace_id INTEGER PRIMARY KEY REFERENCES companies(id),
          tg_config TEXT, templates TEXT, alert_settings TEXT, notified_ids TEXT,
          integration_review_required INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE workspace_migration_quarantine (
          id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE logistics_rows ADD COLUMN workspace_id INTEGER REFERENCES companies(id);
        CREATE INDEX logistics_workspace_deleted ON logistics_rows(workspace_id,deleted_at);
        CREATE UNIQUE INDEX logistics_workspace_row ON logistics_rows(workspace_id,id);
        CREATE TABLE workspace_grants (
          source_workspace_id INTEGER NOT NULL REFERENCES companies(id),
          scope_type TEXT NOT NULL CHECK(scope_type IN ('row','group','agency')),
          scope_value TEXT NOT NULL,
          row_id TEXT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          granted_by_user_id INTEGER NOT NULL REFERENCES users(id),
          role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(source_workspace_id,scope_type,scope_value,user_id),
          FOREIGN KEY(source_workspace_id,row_id) REFERENCES logistics_rows(workspace_id,id),
          CHECK((scope_type='row' AND row_id=scope_value) OR (scope_type!='row' AND row_id IS NULL))
        );
        CREATE INDEX workspace_grants_recipient ON workspace_grants(user_id,source_workspace_id);
        CREATE TABLE workspace_share_invitations (
          id INTEGER PRIMARY KEY,
          source_workspace_id INTEGER NOT NULL REFERENCES companies(id),
          sender_user_id INTEGER NOT NULL REFERENCES users(id),
          receiver_user_id INTEGER NOT NULL REFERENCES users(id),
          scope_type TEXT NOT NULL CHECK(scope_type IN ('row','group','agency')),
          scope_value TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, responded_at TEXT
        );
      `);
      archiveMarkerMigration(db);
      const orphanTrips=db.prepare(`SELECT r.id,r.user_id FROM logistics_rows r LEFT JOIN users u ON u.id=r.user_id WHERE u.id IS NULL ORDER BY r.id`).all() as {id:string;user_id:number}[];
      if(options.orphanTripAssignment) {
        const assignment=options.orphanTripAssignment;
        const companyName=assignment.companyName.trim();
        if(!companyName||companyName.length>100||!Number.isSafeInteger(assignment.expectedTripCount)||assignment.expectedTripCount<1)throw new Error('Invalid staging orphan assignment configuration');
        if(orphanTrips.length!==assignment.expectedTripCount)throw new Error('Staging orphan trips no longer match the approved count');
        if(orphanTrips.some(trip=>!Number.isSafeInteger(trip.user_id)||trip.user_id<1))throw new Error('Orphan recovery requires valid historic creator IDs');
        if(db.prepare('SELECT 1 FROM companies WHERE name=?').get(companyName))throw new Error('Orphan recovery requires a new testing company');
        const workspaceId=Number(db.prepare('INSERT INTO companies(name) VALUES (?)').run(companyName).lastInsertRowid);
        for(const creatorId of new Set(orphanTrips.map(trip=>trip.user_id))) {
          let username=`archived_creator_${creatorId}`;
          while(db.prepare('SELECT 1 FROM users WHERE username=?').get(username))username=`archived_${randomBytes(10).toString('hex')}`;
          // This is a locked historical reference, not a revived customer identity.
          const password=bcrypt.hashSync(randomBytes(48).toString('hex'),10);
          db.prepare(`INSERT INTO users(id,username,password,role,is_active,company_id,is_archived_creator) VALUES (?,?,?,'user',0,?,1)`)
            .run(creatorId,username,password,workspaceId);
          recoveredCreatorWorkspaces.set(creatorId,workspaceId);
          db.prepare('INSERT INTO workspace_migration_quarantine(kind,payload) VALUES (?,?)').run('staging_orphan_trip_assignment',JSON.stringify({
            sourceCreatorUserId:creatorId,workspaceId,tripIds:orphanTrips.filter(trip=>trip.user_id===creatorId).map(trip=>trip.id),
          }));
        }
      }
      const users = db.prepare("SELECT id,role,is_active,company_id,is_archived_creator FROM users ORDER BY is_active DESC,id").all() as any[];
      for (const user of users) {
        let workspaceId = recoveredCreatorWorkspaces.get(user.id) ?? (originalCompanyIds.has(user.company_id) ? user.company_id : null);
        if (!workspaceId) {
          workspaceId = Number(db.prepare('INSERT INTO companies(name) VALUES (?)').run(`Staging workspace — account ${user.id}`).lastInsertRowid);
        }
        if (user.role !== 'admin' && !user.is_archived_creator) {
          const owner = db.prepare("SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND role='owner'").get(workspaceId);
          db.prepare('INSERT INTO workspace_memberships(workspace_id,user_id,role,is_active) VALUES (?,?,?,?)')
            .run(workspaceId,user.id,owner ? 'editor' : 'owner',user.is_active ? 1 : 0);
        }
        db.prepare('UPDATE logistics_rows SET workspace_id=? WHERE user_id=?').run(workspaceId,user.id);
      }
      if (db.prepare('SELECT 1 FROM logistics_rows WHERE workspace_id IS NULL LIMIT 1').get()) {
        throw new Error('Workspace migration requires reviewed orphan trip ownership');
      }
      // Retain ambiguous legacy shares in a private, recoverable quarantine.
      // They cannot participate in the new source-scoped authorization queries.
      for (const table of ['trip_row_access','trip_group_access','trip_agency_access','trip_share_invitations']) {
        for (const entry of db.prepare(`SELECT * FROM ${table}`).all()) {
          db.prepare('INSERT INTO workspace_migration_quarantine(kind,payload) VALUES (?,?)').run(table,JSON.stringify(entry));
        }
        db.exec(`DELETE FROM ${table}`);
      }
      for (const setting of db.prepare('SELECT * FROM settings WHERE user_id NOT IN (SELECT id FROM users WHERE is_archived_creator=0)').all() as any[]) {
        db.prepare('INSERT INTO workspace_migration_quarantine(kind,payload) VALUES (?,?)').run('orphan_settings',JSON.stringify(setting));
        db.prepare('DELETE FROM settings WHERE user_id=?').run(setting.user_id);
      }
      for (const { id } of db.prepare('SELECT id FROM companies').all() as {id:number}[]) {
        const configured = db.prepare(`SELECT s.* FROM settings s JOIN workspace_memberships m ON m.user_id=s.user_id
          WHERE m.workspace_id=? AND (s.tg_config IS NOT NULL OR s.templates IS NOT NULL OR s.extra_settings IS NOT NULL)`).all(id) as any[];
        const setting = configured.length === 1 ? configured[0] : null;
        let alerts = null;
        try { alerts = setting?.extra_settings ? JSON.stringify(JSON.parse(setting.extra_settings).alertSettings ?? null) : null; } catch { /* retain legacy setting for review */ }
        db.prepare('INSERT INTO workspace_settings(workspace_id,tg_config,templates,alert_settings,notified_ids,integration_review_required) VALUES (?,?,?,?,?,?)')
          .run(id,setting?.tg_config ?? null,setting?.templates ?? null,alerts,setting?.notified_ids ?? null,configured.length > 1 ? 1 : 0);
      }
      db.exec(`
        CREATE TRIGGER logistics_workspace_insert BEFORE INSERT ON logistics_rows BEGIN
          SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id
            WHERE m.user_id=NEW.user_id AND m.is_active=1 AND u.is_active=1 AND u.is_archived_creator=0 AND m.role!='viewer'
            AND (NEW.workspace_id IS NULL OR NEW.workspace_id=m.workspace_id))
            THEN RAISE(ABORT,'Invalid workspace membership') END;
        END;
        CREATE TRIGGER logistics_workspace_default AFTER INSERT ON logistics_rows WHEN NEW.workspace_id IS NULL BEGIN
          UPDATE logistics_rows SET workspace_id=(SELECT workspace_id FROM workspace_memberships WHERE user_id=NEW.user_id) WHERE id=NEW.id;
        END;
        CREATE TRIGGER logistics_workspace_immutable BEFORE UPDATE OF workspace_id,user_id ON logistics_rows
          WHEN (OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS NOT OLD.workspace_id) OR NEW.user_id!=OLD.user_id
          BEGIN SELECT RAISE(ABORT,'Trip ownership is immutable'); END;
        INSERT INTO schema_migrations(version) VALUES (1);
      `);
      migrateSubscriptionSchema(db);
      companySharingMigration(db);
      if(JSON.stringify(db.prepare(historicTripsQuery).all())!==historicTrips)throw new Error('Workspace migration changed historic trip records');
      if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Workspace migration foreign-key validation failed');
    })();
  } finally { db.pragma('foreign_keys = ON'); }
}
