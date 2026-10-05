import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyWorkspaceDatabase(db:Database.Database) {
  const version=(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as any)?.version;
  if(!version||version<2)throw new Error('Workspace schema version is missing or outdated');
  if(!(db.pragma('table_info(users)') as {name:string}[]).some(column=>column.name==='is_archived_creator'))throw new Error('Workspace archive marker is missing');
  if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Workspace database integrity check failed');
  if((db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Workspace foreign-key check failed');
  if(db.prepare('SELECT 1 FROM logistics_rows WHERE workspace_id IS NULL LIMIT 1').get())throw new Error('Workspace trip ownership is missing');
  return {version,trips:(db.prepare('SELECT COUNT(*) AS count FROM logistics_rows').get() as any).count,
    memberships:(db.prepare('SELECT COUNT(*) AS count FROM workspace_memberships').get() as any).count};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.env.UMRAH_DEPLOYMENT_ENV!=='staging')throw new Error('This verification command is staging-only');
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--db')throw new Error('Usage: tsx scripts/verify-workspaces.ts --db /path/to/staging.db');
  const deadline=Date.now()+30_000;
  while(true) {
    let db:Database.Database|undefined;
    try {
      db=new Database(args[1],{readonly:true,fileMustExist:true});
      console.log('Staging workspace migration verified:',JSON.stringify(verifyWorkspaceDatabase(db)));
      break;
    } catch(error) {
      if(Date.now()>=deadline)throw error;
    } finally { db?.close(); }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
