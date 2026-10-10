import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertWorkspaceApproval, migrateStagingWorkspaces } from '../server/migrations.js';
import { productionWorkspaceApproval, productionOwnerByCompanyId, productionInitialCompanySharing } from '../server/productionWorkspaceApproval.js';
import { verifyWorkspaceDatabase } from './verify-workspaces.js';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--db')throw new Error('Usage: tsx scripts/rehearse-production-workspaces.ts --db /path/to/production-snapshot.db');
const source=new Database(args[1],{readonly:true,fileMustExist:true});
const destination=path.join(mkdtempSync(path.join(tmpdir(),'umrah-production-workspace-rehearsal-')),'rehearsal.db');
try { await source.backup(destination); } finally { source.close(); }
const db=new Database(destination);
try {
  assertWorkspaceApproval(db,productionWorkspaceApproval);
  const tripsBefore=JSON.stringify(db.prepare('SELECT id,user_id,data,version,updated_at,deleted_at,deleted_by_user_id FROM logistics_rows ORDER BY id').all());
  const settingsBefore=JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY user_id').all());
  const companiesBefore=JSON.stringify(db.prepare('SELECT id,name FROM companies ORDER BY id').all());
  migrateStagingWorkspaces(db,{approval:productionWorkspaceApproval,ownerByCompanyId:productionOwnerByCompanyId,initialCompanySharing:productionInitialCompanySharing});
  if(JSON.stringify(db.prepare('SELECT id,user_id,data,version,updated_at,deleted_at,deleted_by_user_id FROM logistics_rows ORDER BY id').all())!==tripsBefore)
    throw new Error('Rehearsal changed trip records');
  if(JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY user_id').all())!==settingsBefore)
    throw new Error('Rehearsal changed personal settings');
  if(JSON.stringify(db.prepare('SELECT id,name FROM companies WHERE id IN (2,3,4) ORDER BY id').all())!==companiesBefore)
    throw new Error('Rehearsal changed existing company identities');
  for(const [companyId,ownerId] of Object.entries(productionOwnerByCompanyId)) {
    if(!db.prepare("SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND role='owner'").get(Number(companyId),ownerId))
      throw new Error('Rehearsal did not assign approved company owner');
  }
  if((db.prepare('SELECT share_all_trips AS enabled FROM companies WHERE id=2').get() as {enabled:number}).enabled!==0)
    throw new Error('Rehearsal exposed company trips to other members');
  const expectedArchive=Object.values(productionWorkspaceApproval.legacyShares).reduce((sum,n)=>sum+n,0);
  const archiveCount=(db.prepare("SELECT COUNT(*) AS count FROM workspace_migration_quarantine WHERE kind IN ('trip_row_access','trip_group_access','trip_agency_access','trip_share_invitations')").get() as {count:number}).count;
  if(archiveCount!==expectedArchive)throw new Error('Rehearsal lost legacy sharing history');
  const verified=verifyWorkspaceDatabase(db);
  if((db.prepare('SELECT COUNT(*) AS count FROM companies').get() as {count:number}).count!==9)
    throw new Error('Rehearsal created an unexpected workspace');
  console.log('Production workspace rehearsal passed:',JSON.stringify({
    ...verified,companies:(db.prepare('SELECT COUNT(*) AS count FROM companies').get() as {count:number}).count,
    archivedLegacyShares:archiveCount,tripRecordsPreserved:true,personalSettingsPreserved:true,
  }));
}finally{db.close();}
