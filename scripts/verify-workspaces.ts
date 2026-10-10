import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyWorkspaceDatabase(db:Database.Database) {
  const version=(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as any)?.version;
  if(!version||version<5)throw new Error('Workspace schema version is missing or outdated');
  if(!(db.pragma('table_info(companies)') as {name:string}[]).some(column=>column.name==='share_all_trips'))throw new Error('Company sharing policy is missing');
  if(!(db.pragma('table_info(companies)') as {name:string}[]).some(column=>column.name==='manager_sees_all_trips'))throw new Error('Manager visibility policy is missing');
  if(!(db.pragma('table_info(users)') as {name:string}[]).some(column=>column.name==='is_archived_creator'))throw new Error('Workspace archive marker is missing');
  if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Workspace database integrity check failed');
  if((db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Workspace foreign-key check failed');
  if(db.prepare('SELECT 1 FROM logistics_rows WHERE workspace_id IS NULL LIMIT 1').get())throw new Error('Workspace trip ownership is missing');
  if(db.prepare('SELECT 1 FROM companies c WHERE NOT EXISTS(SELECT 1 FROM workspace_subscriptions s WHERE s.workspace_id=c.id) LIMIT 1').get())throw new Error('Workspace subscription storage is missing');
  return {version,trips:(db.prepare('SELECT COUNT(*) AS count FROM logistics_rows').get() as any).count,
    memberships:(db.prepare('SELECT COUNT(*) AS count FROM workspace_memberships').get() as any).count};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!['staging','production'].includes(process.env.UMRAH_DEPLOYMENT_ENV||''))throw new Error('Workspace verification requires an explicit deployment environment');
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--db')throw new Error('Usage: tsx scripts/verify-workspaces.ts --db /path/to/staging.db');
  const deadline=Date.now()+30_000;
  while(true) {
    let db:Database.Database|undefined;
    try {
      db=new Database(args[1],{readonly:true,fileMustExist:true});
      console.log('Workspace migration verified:',JSON.stringify(verifyWorkspaceDatabase(db)));
      break;
    } catch(error) {
      if(Date.now()>=deadline)throw error;
    } finally { db?.close(); }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
