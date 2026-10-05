import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrateStagingWorkspaces, workspaceFeatureEnabled } from '../server/migrations';

const legacy=()=>{
  const db=new Database(':memory:');
  db.pragma('foreign_keys=OFF');
  db.exec(`CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT UNIQUE);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,role TEXT,is_active INTEGER,company_id INTEGER);
    CREATE TABLE logistics_rows(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),data TEXT,deleted_at TEXT);
    CREATE TABLE settings(user_id INTEGER PRIMARY KEY REFERENCES users(id),tg_config TEXT,templates TEXT,extra_settings TEXT,notified_ids TEXT);
    CREATE TABLE trip_row_access(row_id TEXT,user_id INTEGER,granted_by_user_id INTEGER);
    CREATE TABLE trip_group_access(group_no TEXT,user_id INTEGER,granted_by_user_id INTEGER);
    CREATE TABLE trip_agency_access(agency TEXT,user_id INTEGER,granted_by_user_id INTEGER);
    CREATE TABLE trip_share_invitations(id INTEGER PRIMARY KEY,sender_user_id INTEGER,receiver_user_id INTEGER);
    INSERT INTO users VALUES(1,'one','user',1,NULL),(2,'two','user',0,NULL);
    INSERT INTO logistics_rows VALUES('a',1,'{"groupNo":"100"}',NULL),('b',2,'{"groupNo":"100"}','2026-01-01');
    INSERT INTO settings VALUES(1,'synthetic-encrypted-settings',NULL,NULL,'["a"]'),(999,'orphan-secret',NULL,NULL,NULL);
    INSERT INTO trip_group_access VALUES('100',2,1);`);
  return db;
};

describe('staging workspace migration',()=>{
  it('enables workspace behavior only in staging or its explicit test mode',()=>{
    expect(workspaceFeatureEnabled({NODE_ENV:'production'})).toBe(false);
    expect(workspaceFeatureEnabled({NODE_ENV:'production',UMRAH_DEPLOYMENT_ENV:'staging'})).toBe(true);
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
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{version:1}]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('foreign_keys',{simple:true})).toBe(1);
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
