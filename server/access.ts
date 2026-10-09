import type { Database } from 'better-sqlite3';
import { canSeeAllWorkspaceTrips, workspaceForUser } from './workspaces';

export type RowAccess = { scope:'owner'|'row'|'group'|'agency'; role:'owner'|'editor'|'viewer' };
const recordColumns = 'r.id,r.user_id,r.workspace_id,r.data,r.version,r.updated_at,r.deleted_at,r.deleted_by_user_id';

const scopeMatches = `((g.scope_type='row' AND g.scope_value=r.id)
  OR (g.scope_type='group' AND g.scope_value=workspace_group(r.data))
  OR (g.scope_type='agency' AND g.scope_value=workspace_agency(r.data)))`;

export function registerWorkspaceAccessFunctions(db:Database) {
  const field=(data:unknown,key:string,trim=false)=>{
    try { const row=JSON.parse(String(data)); const value=String(row[key]||''); return trim ? value.trim() : value; }
    catch { return ''; }
  };
  db.function('workspace_group',{deterministic:true},data=>field(data,'groupNo'));
  db.function('workspace_agency',{deterministic:true},data=>field(data,'agency',true));
}

export function workspaceRows(db:Database,userId:number,deleted=false): any[] {
  const membership=workspaceForUser(db,userId);
  if (!membership) return [];
  const companyWide=canSeeAllWorkspaceTrips(membership);
  return db.prepare(`SELECT ${recordColumns} FROM logistics_rows r
    WHERE r.deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'} AND r.workspace_id=? ${companyWide?'':'AND r.user_id=?'}
    UNION SELECT ${recordColumns} FROM workspace_grants g JOIN logistics_rows r ON r.workspace_id=g.source_workspace_id
    WHERE g.user_id=? AND r.deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'} AND ${scopeMatches} ORDER BY id`)
    .all(...(companyWide?[membership.workspaceId]:[membership.workspaceId,userId]),userId);
}

export function workspaceRowAccess(db:Database,userId:number,rowId:string): RowAccess|null {
  const member=workspaceForUser(db,userId);
  if (!member) return null;
  const record=db.prepare('SELECT workspace_id,user_id,data FROM logistics_rows WHERE id=?').get(rowId) as any;
  if (!record) return null;
  if (record.workspace_id===member.workspaceId && (canSeeAllWorkspaceTrips(member)||record.user_id===userId)) {
    return {scope:'owner',role: member.role==='viewer' ? 'viewer' : member.role==='owner' ? 'owner' : 'editor'};
  }
  const grant=db.prepare(`SELECT g.scope_type AS scope,g.role FROM workspace_grants g
    JOIN logistics_rows r ON r.workspace_id=g.source_workspace_id
    WHERE r.id=? AND g.user_id=? AND ${scopeMatches} ORDER BY (g.role='editor') DESC LIMIT 1`).get(rowId,userId) as RowAccess|undefined;
  return grant ? {...grant,role:member.role==='viewer' ? 'viewer' : grant.role} : null;
}

export function workspaceEventRecipients(db:Database,rowId:string): Set<number> {
  const record=db.prepare('SELECT workspace_id,user_id FROM logistics_rows WHERE id=?').get(rowId) as any;
  if (!record) return new Set();
  const members=db.prepare(`SELECT m.user_id FROM workspace_memberships m JOIN users u ON u.id=m.user_id JOIN companies c ON c.id=m.workspace_id
    WHERE m.workspace_id=? AND m.is_active=1 AND u.is_active=1 AND u.is_archived_creator=0 AND u.role!='admin'
      AND (m.role='owner' OR (m.role='manager' AND c.manager_sees_all_trips=1)
        OR (m.role IN ('editor','viewer') AND c.share_all_trips=1) OR m.user_id=?)`).all(record.workspace_id,record.user_id) as {user_id:number}[];
  const grants=db.prepare(`SELECT DISTINCT g.user_id FROM workspace_grants g JOIN logistics_rows r ON r.workspace_id=g.source_workspace_id
    JOIN workspace_memberships m ON m.user_id=g.user_id JOIN users u ON u.id=m.user_id
    WHERE r.id=? AND ${scopeMatches} AND m.is_active=1 AND u.is_active=1 AND u.is_archived_creator=0 AND u.role!='admin'`).all(rowId) as {user_id:number}[];
  return new Set([...members,...grants].map(m=>m.user_id));
}
