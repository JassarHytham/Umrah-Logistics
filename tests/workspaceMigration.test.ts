import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrateStagingWorkspaces, workspaceFeatureEnabled } from '../server/migrations';
import { provisionWorkspaceMember, workspaceForUser } from '../server/workspaces';
import { registerWorkspaceAccessFunctions, workspaceRowAccess } from '../server/access';

const legacy=()=>{
  const db=new Database(':memory:');
  db.pragma('foreign_keys=OFF');
  db.exec(`CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT UNIQUE);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,role TEXT,is_active INTEGER,company_id INTEGER,password TEXT NOT NULL DEFAULT 'synthetic-hash');
    CREATE TABLE logistics_rows(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),data TEXT,deleted_at TEXT);
    CREATE TABLE settings(user_id INTEGER PRIMARY KEY REFERENCES users(id),tg_config TEXT,templates TEXT,extra_settings TEXT,notified_ids TEXT);
    CREATE TABLE trip_row_access(row_id TEXT,user_id INTEGER,granted_by_user_id INTEGER);
    CREATE TABLE trip_group_access(group_no TEXT,user_id INTEGER,granted_by_user_id INTEGER);
    CREATE TABLE trip_agency_access(agency TEXT,user_id INTEGER,granted_by_user_id INTEGER);
    CREATE TABLE trip_share_invitations(id INTEGER PRIMARY KEY,sender_user_id INTEGER,receiver_user_id INTEGER);
    INSERT INTO users(id,username,role,is_active,company_id) VALUES(1,'one','user',1,NULL),(2,'two','user',0,NULL);
    INSERT INTO logistics_rows VALUES('a',1,'{"groupNo":"100"}',NULL),('b',2,'{"groupNo":"100"}','2026-01-01');
    INSERT INTO settings VALUES(1,'synthetic-encrypted-settings',NULL,NULL,'["a"]'),(999,'orphan-secret',NULL,NULL,NULL);
    INSERT INTO trip_group_access VALUES('100',2,1);`);
  return db;
};

describe('staging workspace migration',()=>{
  it('enables workspace behavior only in staging or its explicit test mode',()=>{
    expect(workspaceFeatureEnabled({NODE_ENV:'production'})).toBe(false);
    expect(workspaceFeatureEnabled({NODE_ENV:'production',UMRAH_DEPLOYMENT_ENV:'staging'})).toBe(true);
    expect(workspaceFeatureEnabled({NODE_ENV:'production',UMRAH_DEPLOYMENT_ENV:'staging',STAGING_WORKSPACES_ENABLED:'false'})).toBe(false);
    expect(workspaceFeatureEnabled({NODE_ENV:'test'})).toBe(false);
    expect(workspaceFeatureEnabled({NODE_ENV:'test',WORKSPACE_TEST_MODE:'true'})).toBe(true);
  });
  it('preserves trips and disabled memberships, quarantines ambiguous shares/secrets and runs once',()=>{
    const db=legacy();
    try{
      migrateStagingWorkspaces(db); migrateStagingWorkspaces(db);
      expect(db.prepare('SELECT COUNT(*) AS count FROM logistics_rows').get()).toEqual({count:2});
      const rows:any[]=db.prepare('SELECT id,user_id,workspace_id,deleted_at FROM logistics_rows ORDER BY id').all();
      expect(rows[0]).toMatchObject({id:'a',user_id:1,deleted_at:null});
      expect(rows[1]).toMatchObject({id:'b',user_id:2,deleted_at:'2026-01-01'});
      expect(rows[0].workspace_id).not.toBe(rows[1].workspace_id);
      expect(db.prepare('SELECT is_active FROM workspace_memberships WHERE user_id=2').get()).toEqual({is_active:0});
      expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_grants').get()).toEqual({count:0});
      expect(db.prepare('SELECT kind FROM workspace_migration_quarantine ORDER BY id').all()).toEqual([{kind:'trip_group_access'},{kind:'orphan_settings'}]);
      expect(db.prepare('SELECT tg_config FROM workspace_settings WHERE workspace_id=?').get(rows[0].workspace_id)).toEqual({tg_config:'synthetic-encrypted-settings'});
      expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{version:1},{version:2}]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('foreign_keys',{simple:true})).toBe(1);
    }finally{db.close();}
  });
  it('assigns the approved five orphan trips to a new testing company while preserving every trip and creator ID',()=>{
    const db=legacy();
    try{
      for(let index=0;index<5;index++)db.prepare('INSERT INTO logistics_rows VALUES(?,?,?,?)').run(`recovered-${index}`,index<3?999:1000,JSON.stringify({id:`recovered-${index}`,notes:'synthetic history'}),index===4?'2026-01-01':null);
      const before=db.prepare('SELECT id,user_id,data,deleted_at FROM logistics_rows ORDER BY id').all();
      const options={orphanTripAssignment:{companyName:'Staging Testing Company',expectedTripCount:5}};
      migrateStagingWorkspaces(db,options);migrateStagingWorkspaces(db,options);
      const company=db.prepare('SELECT id FROM companies WHERE name=?').get('Staging Testing Company') as any;
      expect(company).toBeDefined();
      expect(db.prepare("SELECT COUNT(*) AS count FROM logistics_rows WHERE workspace_id=? AND id LIKE 'recovered-%'").get(company.id)).toEqual({count:5});
      expect(db.prepare('SELECT id,user_id,data,deleted_at FROM logistics_rows ORDER BY id').all()).toEqual(before);
      expect(db.prepare('SELECT id,is_active,is_archived_creator,company_id FROM users WHERE id IN (999,1000) ORDER BY id').all()).toEqual([
        {id:999,is_active:0,is_archived_creator:1,company_id:company.id},{id:1000,is_active:0,is_archived_creator:1,company_id:company.id},
      ]);
      expect(db.prepare('SELECT 1 FROM workspace_memberships WHERE user_id IN (999,1000)').get()).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) AS count FROM workspace_migration_quarantine WHERE kind='staging_orphan_trip_assignment'").get()).toEqual({count:2});
      expect(db.prepare('SELECT 1 FROM settings WHERE user_id=999').get()).toBeUndefined();
      expect(db.pragma('foreign_key_check')).toEqual([]);
      // The first real testing member, not a historical creator, becomes owner.
      db.prepare("INSERT INTO users(id,username,password,role,is_active,company_id) VALUES (2000,'testing_owner','synthetic-hash','user',1,?)").run(company.id);
      provisionWorkspaceMember(db,2000,company.id);registerWorkspaceAccessFunctions(db);
      expect(workspaceForUser(db,2000)).toMatchObject({workspaceId:company.id,role:'owner'});
      expect(workspaceRowAccess(db,2000,'recovered-0')).toEqual({scope:'owner',role:'owner'});
      expect(workspaceRowAccess(db,1,'recovered-0')).toBeNull();
    }finally{db.close();}
  });
  it('upgrades an existing version-one workspace database without changing its trips',()=>{
    const db=legacy();try{
      migrateStagingWorkspaces(db);
      db.exec(`DROP TRIGGER logistics_workspace_insert;
        ALTER TABLE users DROP COLUMN is_archived_creator;
        CREATE TRIGGER logistics_workspace_insert BEFORE INSERT ON logistics_rows BEGIN
          SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id
            WHERE m.user_id=NEW.user_id AND m.is_active=1 AND u.is_active=1 AND m.role!='viewer'
            AND (NEW.workspace_id IS NULL OR NEW.workspace_id=m.workspace_id))
            THEN RAISE(ABORT,'Invalid workspace membership') END;
        END;
        DELETE FROM schema_migrations WHERE version=2;`);
      const before=db.prepare('SELECT * FROM logistics_rows ORDER BY id').all();
      migrateStagingWorkspaces(db);migrateStagingWorkspaces(db);
      expect(db.prepare('SELECT * FROM logistics_rows ORDER BY id').all()).toEqual(before);
      expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{version:1},{version:2}]);
      expect(db.prepare('SELECT is_archived_creator FROM users WHERE id=1').get()).toEqual({is_archived_creator:0});
    }finally{db.close();}
  });
  it('never treats dangling legacy company IDs as newly allocated testing or fallback workspaces',()=>{
    const db=legacy();try{
      db.exec("INSERT INTO companies VALUES(1,'Existing Company');UPDATE users SET company_id=2 WHERE id=1;UPDATE users SET company_id=3 WHERE id=2");
      for(let index=0;index<5;index++)db.prepare('INSERT INTO logistics_rows VALUES(?,?,?,NULL)').run(`recovered-${index}`,999,'{}');
      migrateStagingWorkspaces(db,{orphanTripAssignment:{companyName:'Staging Testing Company',expectedTripCount:5}});
      const testing=db.prepare("SELECT id FROM companies WHERE name='Staging Testing Company'").get() as any;
      const first=workspaceForUser(db,1);
      expect(first?.workspaceId).not.toBe(testing.id);
      expect(db.prepare('SELECT workspace_id FROM workspace_memberships WHERE user_id=2').get()).not.toEqual({workspace_id:first?.workspaceId});
      expect(db.prepare('SELECT 1 FROM workspace_memberships WHERE workspace_id=?').get(testing.id)).toBeUndefined();
      expect(db.prepare("SELECT workspace_id FROM logistics_rows WHERE id='a'").get()).toEqual({workspace_id:first?.workspaceId});
      registerWorkspaceAccessFunctions(db);
      expect(workspaceRowAccess(db,1,'recovered-0')).toBeNull();
    }finally{db.close();}
  });
  it('rejects an approved recovery when no orphan trips remain and rolls back',()=>{
    const db=legacy();try{
      expect(()=>migrateStagingWorkspaces(db,{orphanTripAssignment:{companyName:'Staging Testing Company',expectedTripCount:5}})).toThrow('approved count');
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_memberships'").get()).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS count FROM companies').get()).toEqual({count:0});
    }finally{db.close();}
  });
  it('rolls back recovery when the orphan count no longer matches the approved scope',()=>{
    const db=legacy();try{
      db.exec("INSERT INTO logistics_rows VALUES('orphan',999,'{}',NULL)");
      expect(()=>migrateStagingWorkspaces(db,{orphanTripAssignment:{companyName:'Staging Testing Company',expectedTripCount:5}})).toThrow('approved count');
      expect(db.prepare("SELECT 1 FROM companies WHERE name='Staging Testing Company'").get()).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM users WHERE id=999').get()).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_memberships'").get()).toBeUndefined();
    }finally{db.close();}
  });
  it('does not assign orphan trips to an existing company with the requested testing name',()=>{
    const db=legacy();try{
      db.exec("INSERT INTO companies VALUES(50,'Staging Testing Company');INSERT INTO logistics_rows VALUES('orphan',999,'{}',NULL)");
      expect(()=>migrateStagingWorkspaces(db,{orphanTripAssignment:{companyName:'Staging Testing Company',expectedTripCount:1}})).toThrow('new testing company');
      expect(db.prepare('SELECT 1 FROM users WHERE id=999').get()).toBeUndefined();
    }finally{db.close();}
  });
  it('rejects corrupt historic creator IDs without exposing their stored contents',()=>{
    const db=legacy();try{
      db.prepare('INSERT INTO logistics_rows VALUES(?,?,?,NULL)').run('corrupt','synthetic-sensitive-id','{}');
      expect(()=>migrateStagingWorkspaces(db,{orphanTripAssignment:{companyName:'Staging Testing Company',expectedTripCount:1}})).toThrow('valid historic creator IDs');
      expect(db.prepare('SELECT COUNT(*) AS count FROM companies').get()).toEqual({count:0});
    }finally{db.close();}
  });
  it('rolls back the entire numbered migration when an orphan trip lacks a destination',()=>{
    const db=legacy();
    try{
      db.exec("INSERT INTO logistics_rows VALUES('orphan',999,'{}',NULL)");
      expect(()=>migrateStagingWorkspaces(db)).toThrow('orphan trip ownership');
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='workspace_memberships'").get()).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS count FROM logistics_rows').get()).toEqual({count:3});
      expect(db.prepare('SELECT COUNT(*) AS count FROM trip_group_access').get()).toEqual({count:1});
    }finally{db.close();}
  });
});
