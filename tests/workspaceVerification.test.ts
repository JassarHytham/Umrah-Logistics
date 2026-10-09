import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { verifyWorkspaceDatabase } from '../scripts/verify-workspaces';

const database=()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE companies(id INTEGER PRIMARY KEY,share_all_trips INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users(id INTEGER PRIMARY KEY,is_archived_creator INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE workspace_subscriptions(workspace_id INTEGER PRIMARY KEY REFERENCES companies(id));
    CREATE TABLE workspace_memberships(user_id INTEGER);
    CREATE TABLE logistics_rows(id TEXT,workspace_id INTEGER REFERENCES companies(id));
    INSERT INTO schema_migrations VALUES(1),(2),(3),(4);INSERT INTO companies(id) VALUES(1);
    INSERT INTO workspace_subscriptions VALUES(1);
    INSERT INTO workspace_memberships VALUES(1);INSERT INTO logistics_rows VALUES('synthetic',1);`);
  return db;
};
describe('staging deployed workspace verification',()=>{
  it('reports only schema and aggregate counts after validating integrity and ownership',()=>{
    const db=database();try{expect(verifyWorkspaceDatabase(db)).toEqual({version:4,trips:1,memberships:1});}finally{db.close();}
  });
  it('rejects version one without archived-identity protection',()=>{
    const db=database();try{db.exec('DELETE FROM schema_migrations WHERE version>=2');expect(()=>verifyWorkspaceDatabase(db)).toThrow('schema version');}finally{db.close();}
  });
  it('rejects a version-two database without subscription storage',()=>{
    const db=database();try{db.exec('DELETE FROM schema_migrations WHERE version>=3');expect(()=>verifyWorkspaceDatabase(db)).toThrow('schema version');}finally{db.close();}
  });
  it('rejects schema three or a missing sharing-policy column',()=>{
    const db=database();try{
      db.exec('DELETE FROM schema_migrations WHERE version=4');expect(()=>verifyWorkspaceDatabase(db)).toThrow('schema version');
      db.exec('INSERT INTO schema_migrations VALUES(4);ALTER TABLE companies DROP COLUMN share_all_trips');expect(()=>verifyWorkspaceDatabase(db)).toThrow('sharing policy');
    }finally{db.close();}
  });
  it('rejects missing workspace subscription records',()=>{
    const db=database();try{db.exec('DELETE FROM workspace_subscriptions');expect(()=>verifyWorkspaceDatabase(db)).toThrow('subscription');}finally{db.close();}
  });
  it('rejects a claimed version two without its archive marker',()=>{
    const db=database();try{db.exec('ALTER TABLE users DROP COLUMN is_archived_creator');expect(()=>verifyWorkspaceDatabase(db)).toThrow('archive marker');}finally{db.close();}
  });
  it('rejects incomplete migrations',()=>{
    const db=database();try{db.exec('DELETE FROM schema_migrations');expect(()=>verifyWorkspaceDatabase(db)).toThrow('schema version');}finally{db.close();}
  });
  it('rejects trips with missing workspace ownership',()=>{
    const db=database();try{db.exec('UPDATE logistics_rows SET workspace_id=NULL');expect(()=>verifyWorkspaceDatabase(db)).toThrow('ownership');}finally{db.close();}
  });
  it('rejects broken workspace references',()=>{
    const db=database();try{db.pragma('foreign_keys=OFF');db.exec('UPDATE logistics_rows SET workspace_id=999');expect(()=>verifyWorkspaceDatabase(db)).toThrow('foreign-key');}finally{db.close();}
  });
});
