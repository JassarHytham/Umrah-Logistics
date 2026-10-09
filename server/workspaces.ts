import type { Database } from 'better-sqlite3';

export type WorkspaceRole = 'owner' | 'manager' | 'editor' | 'viewer';
export type WorkspaceContext = { workspaceId:number; userId:number; role:WorkspaceRole; name:string; shareAllTrips:boolean; managerSeesAllTrips:boolean };

export const canSeeAllWorkspaceTrips = (member:WorkspaceContext) => member.role==='owner'
  || (member.role==='manager' ? member.managerSeesAllTrips : member.shareAllTrips);

export const isArchivedCreator = (db:Database,userId:number) => Boolean(
  (db.prepare('SELECT is_archived_creator FROM users WHERE id=?').get(userId) as any)?.is_archived_creator,
);

export function workspaceForUser(db: Database, userId: number): WorkspaceContext | null {
  const member=db.prepare(`SELECT m.workspace_id AS workspaceId,m.user_id AS userId,m.role,c.name,c.share_all_trips AS shareAllTrips,c.manager_sees_all_trips AS managerSeesAllTrips
    FROM workspace_memberships m JOIN users u ON u.id=m.user_id JOIN companies c ON c.id=m.workspace_id
    WHERE m.user_id=? AND m.is_active=1 AND u.is_active=1 AND u.is_archived_creator=0 AND u.role!='admin'`).get(userId) as (Omit<WorkspaceContext,'shareAllTrips'|'managerSeesAllTrips'>&{shareAllTrips:number;managerSeesAllTrips:number})|undefined;
  return member ? {...member,shareAllTrips:member.shareAllTrips===1,managerSeesAllTrips:member.managerSeesAllTrips===1} : null;
}

export function provisionWorkspaceMember(db: Database, userId:number, companyId:number|null) {
  const account = db.prepare('SELECT username,role FROM users WHERE id=?').get(userId) as any;
  if (!account || account.role==='admin' || isArchivedCreator(db,userId)) return;
  const workspaceId = companyId ?? Number(db.prepare('INSERT INTO companies(name) VALUES (?)').run(`Workspace — ${account.username}`).lastInsertRowid);
  const hasOwner = db.prepare("SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND role='owner'").get(workspaceId);
  db.prepare('INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES (?,?,?)').run(workspaceId,userId,hasOwner ? 'editor' : 'owner');
  db.prepare('INSERT OR IGNORE INTO workspace_settings(workspace_id) VALUES (?)').run(workspaceId);
}
