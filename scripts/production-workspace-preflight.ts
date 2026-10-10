import Database from 'better-sqlite3';
import { assertWorkspaceApproval, hasWorkspaceSchema } from '../server/migrations.js';
import { productionWorkspaceApproval, productionOwnerByCompanyId } from '../server/productionWorkspaceApproval.js';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--db')throw new Error('Usage: tsx scripts/production-workspace-preflight.ts --db /path/to/production.db');
const db=new Database(args[1],{readonly:true,fileMustExist:true});
try {
  db.pragma('query_only=ON');
  if(hasWorkspaceSchema(db))throw new Error('Production database is already migrated');
  assertWorkspaceApproval(db,productionWorkspaceApproval);
  for(const [companyId,ownerId] of Object.entries(productionOwnerByCompanyId)) {
    if(!db.prepare("SELECT 1 FROM users WHERE id=? AND company_id=? AND role='user' AND is_active=1").get(ownerId,Number(companyId)))
      throw new Error('Approved company owner no longer matches production');
  }
  if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Production database integrity check failed');
  console.log('Production workspace preflight passed:',JSON.stringify({
    accounts:productionWorkspaceApproval.accounts.length,
    companies:productionWorkspaceApproval.companyIds.length,
    legacyShares:Object.values(productionWorkspaceApproval.legacyShares).reduce((sum,n)=>sum+n,0),
    trips:(db.prepare('SELECT COUNT(*) AS count FROM logistics_rows').get() as {count:number}).count,
  }));
}finally{db.close();}
