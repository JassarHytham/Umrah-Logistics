import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateStagingWorkspaces } from '../server/migrations.js';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--db')throw new Error('Usage: npx tsx scripts/rehearse-workspaces.ts --db /path/to/source.db');
const source=new Database(args[1],{readonly:true,fileMustExist:true});
const rehearsalDirectory=mkdtempSync(path.join(tmpdir(),'umrah-staging-rehearsal-'));
const rehearsalPath=path.join(rehearsalDirectory,'staging.db');
try{await source.backup(rehearsalPath);}finally{source.close();}
const rehearsal=new Database(rehearsalPath);
try{
  const before=JSON.stringify(rehearsal.prepare('SELECT id,user_id,data,deleted_at FROM logistics_rows ORDER BY id').all());
  migrateStagingWorkspaces(rehearsal);
  const after=JSON.stringify(rehearsal.prepare('SELECT id,user_id,data,deleted_at FROM logistics_rows ORDER BY id').all());
  if(before!==after)throw new Error('Rehearsal changed trip records');
  const integrity=rehearsal.pragma('integrity_check',{simple:true});
  const foreignKeys=rehearsal.pragma('foreign_key_check') as unknown[];
  if(integrity!=='ok'||foreignKeys.length)throw new Error('Rehearsal failed database validation');
  process.stdout.write(JSON.stringify({rehearsalPath,tripRecordsPreserved:true,integrity:'ok',foreignKeyViolations:0,
    trips:rehearsal.prepare('SELECT COUNT(*) AS count FROM logistics_rows').get(),
    memberships:rehearsal.prepare('SELECT workspace_id AS workspaceId,user_id AS userId,role,is_active AS isActive FROM workspace_memberships ORDER BY user_id').all(),
    quarantine:rehearsal.prepare('SELECT kind,COUNT(*) AS count FROM workspace_migration_quarantine GROUP BY kind').all(),
    schemaVersions:rehearsal.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
  },null,2)+'\n');
}finally{rehearsal.close();}
