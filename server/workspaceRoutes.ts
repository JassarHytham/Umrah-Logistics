import type { Express } from 'express';
import type { Database } from 'better-sqlite3';
import { canSeeAllWorkspaceTrips, workspaceForUser } from './workspaces';
import { workspaceEventRecipients, workspaceRowAccess, workspaceRows } from './access';

type Dependencies={ db:Database; authenticateToken:any; requireAdmin:any; encryptJson:(value:unknown)=>string;
  decryptJson:<T>(value:string|null|undefined,fallback:T)=>T; sendLiveEvent:(ids:Iterable<number>,type:any,actor?:number)=>void; logEvent:(type:string,opts:any)=>void; checkAndSendAlerts:()=>Promise<void> };

export function registerWorkspaceRoutes(app:Express,deps:Dependencies) {
  const {db,authenticateToken,requireAdmin,encryptJson,decryptJson,sendLiveEvent,logEvent}=deps;
  const json=(value:string|null|undefined,fallback:any)=>{ try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  const fail=(res:any,code:string,error:string,status=403)=>res.status(status).json({code,error});
  const context=(req:any,res:any)=>{
    const member=workspaceForUser(db,req.user.id);
    if (!member) { fail(res,'WORKSPACE_REQUIRED','Active workspace membership required'); return null; }
    return member;
  };
  const canManage=(role:string)=>role==='owner'||role==='manager';
  app.patch('/api/admin/companies/:id/trip-sharing',authenticateToken,requireAdmin,(req:any,res)=>{
    const id=Number(req.params.id),enabled=req.body?.shareAllTrips;
    if(!Number.isSafeInteger(id)||id<1||typeof enabled!=='boolean')return fail(res,'INVALID_TRIP_SHARING','A valid company and boolean sharing setting are required',400);
    const company=db.prepare('SELECT share_all_trips FROM companies WHERE id=?').get(id) as {share_all_trips:number}|undefined;
    if(!company)return fail(res,'COMPANY_NOT_FOUND','Company not found',404);
    if(company.share_all_trips!==Number(enabled)) {
      db.transaction(()=>{
        db.prepare('UPDATE companies SET share_all_trips=? WHERE id=?').run(Number(enabled),id);
        logEvent('company_trip_sharing_updated',{category:'company_mgmt',actorUserId:req.user.id,metadata:{companyId:id,shareAllTrips:enabled}});
      })();
      const members=db.prepare('SELECT user_id FROM workspace_memberships WHERE workspace_id=?').all(id) as {user_id:number}[];
      sendLiveEvent(members.map(member=>member.user_id),'rows_changed',req.user.id);
    }
    res.json({success:true,shareAllTrips:enabled});
  });
  app.patch('/api/admin/companies/:id/manager-visibility',authenticateToken,requireAdmin,(req:any,res)=>{
    const id=Number(req.params.id),enabled=req.body?.managerSeesAllTrips;
    if(!Number.isSafeInteger(id)||id<1||typeof enabled!=='boolean')return fail(res,'INVALID_MANAGER_VISIBILITY','A valid company and boolean visibility setting are required',400);
    const company=db.prepare('SELECT manager_sees_all_trips FROM companies WHERE id=?').get(id) as {manager_sees_all_trips:number}|undefined;
    if(!company)return fail(res,'COMPANY_NOT_FOUND','Company not found',404);
    if(company.manager_sees_all_trips!==Number(enabled)) {
      db.transaction(()=>{
        db.prepare('UPDATE companies SET manager_sees_all_trips=? WHERE id=?').run(Number(enabled),id);
        logEvent('company_manager_visibility_updated',{category:'company_mgmt',actorUserId:req.user.id,metadata:{companyId:id,managerSeesAllTrips:enabled}});
      })();
      const managers=db.prepare("SELECT user_id FROM workspace_memberships WHERE workspace_id=? AND role='manager'").all(id) as {user_id:number}[];
      sendLiveEvent(managers.map(manager=>manager.user_id),'rows_changed',req.user.id);
    }
    res.json({success:true,managerSeesAllTrips:enabled});
  });
  app.patch('/api/admin/users/:id/workspace-role',authenticateToken,requireAdmin,(req:any,res)=>{
    const userId=Number(req.params.id),role=req.body?.role;
    if(!Number.isSafeInteger(userId)||userId<1||!['owner','manager','editor','viewer'].includes(role))return fail(res,'INVALID_ROLE','A valid user and workspace role are required',400);
    const member=db.prepare(`SELECT m.workspace_id AS workspaceId,m.role,m.is_active AS membershipActive,u.role AS accountRole,u.is_active AS accountActive,u.is_archived_creator AS archived
      FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=?`).get(userId) as any;
    if(!member||member.accountRole==='admin'||member.archived)return fail(res,'MEMBER_NOT_FOUND','Workspace member not found',404);
    if(role==='owner'&&(!member.accountActive||!member.membershipActive))return fail(res,'INACTIVE_OWNER','Enable the member before transferring ownership',409);
    if(member.role!==role) {
      if(member.role==='owner'&&role!=='owner')return fail(res,'OWNER_REQUIRED','Transfer ownership before changing the current owner role',409);
      const previousOwner=role==='owner'?(db.prepare("SELECT user_id FROM workspace_memberships WHERE workspace_id=? AND role='owner'").get(member.workspaceId) as {user_id:number}|undefined):undefined;
      db.transaction(()=>{
        if(previousOwner&&previousOwner.user_id!==userId)
          db.prepare("UPDATE workspace_memberships SET role='manager' WHERE workspace_id=? AND user_id=?").run(member.workspaceId,previousOwner.user_id);
        db.prepare('UPDATE workspace_memberships SET role=? WHERE workspace_id=? AND user_id=?').run(role,member.workspaceId,userId);
        logEvent('workspace_member_updated',{category:'user_mgmt',actorUserId:req.user.id,targetUserId:userId,metadata:{workspaceId:member.workspaceId,role,previousOwnerUserId:previousOwner?.user_id}});
      })();
      sendLiveEvent([userId,...(previousOwner&&previousOwner.user_id!==userId?[previousOwner.user_id]:[])],'rows_changed',req.user.id);
    }
    res.json({success:true,workspaceRole:role});
  });
  const inviteView=(i:any)=>({id:i.id,sourceWorkspaceId:i.source_workspace_id,scopeType:i.scope_type,
    rowId:i.scope_type==='row'?i.scope_value:null,groupNo:i.scope_type==='group'?i.scope_value:null,
    agency:i.scope_type==='agency'?i.scope_value:null,role:i.role,createdAt:i.created_at,
    senderUsername:i.sender_username,receiverUsername:i.receiver_username});
  const sourceAuthorized=(sender:number,workspace:number,scope?:string,value?:string)=>{
    const member=workspaceForUser(db,sender);
    if(member?.workspaceId!==workspace||member.role==='viewer')return false;
    if(canSeeAllWorkspaceTrips(member))return true;
    // Broad workspace scopes can include coworkers' private/future rows.
    return scope==='row'&&Boolean(db.prepare('SELECT 1 FROM logistics_rows WHERE workspace_id=? AND id=? AND user_id=?').get(workspace,value,sender));
  };
  const notifications=(workspace:number,scope:string,value:string)=>{
    const recipients=new Set<number>();
    const rows=db.prepare('SELECT id,data FROM logistics_rows WHERE workspace_id=?').all(workspace) as any[];
    for (const row of rows) {
      const data=json(row.data,{});
      if ((scope==='row'&&row.id===value)||(scope==='group'&&String(data.groupNo||'')===value)||(scope==='agency'&&String(data.agency||'').trim()===value)) workspaceEventRecipients(db,row.id).forEach(id=>recipients.add(id));
    }
    return recipients;
  };

  app.get('/api/workspace',authenticateToken,(req:any,res)=>{ const member=context(req,res); if(member)res.json(member); });
  app.get('/api/workspace/members',authenticateToken,(req:any,res)=>{
    const member=context(req,res); if(!member)return;
    if(!canManage(member.role))return fail(res,'WORKSPACE_FORBIDDEN','Owner or manager access required');
    res.json(db.prepare(`SELECT m.user_id AS userId,u.username,m.role,m.is_active AS isActive
      FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.user_id`).all(member.workspaceId));
  });
  app.patch('/api/workspace/members/:id',authenticateToken,(req:any,res)=>{
    const actor=context(req,res); if(!actor)return;
    const target=db.prepare('SELECT * FROM workspace_memberships WHERE workspace_id=? AND user_id=?').get(actor.workspaceId,Number(req.params.id)) as any;
    if(!target)return fail(res,'MEMBER_NOT_FOUND','Member not found',404);
    const role=req.body.role??target.role;
    if(!['owner','manager','editor','viewer'].includes(role))return fail(res,'INVALID_ROLE','Invalid workspace role',400);
    if(!canManage(actor.role)||target.role==='owner'||role==='owner'||(actor.role!=='owner'&&(target.role==='manager'||role==='manager')))return fail(res,'WORKSPACE_FORBIDDEN','This membership change requires owner authority');
    const active=req.body.isActive===undefined ? target.is_active : req.body.isActive===true ? 1 : 0;
    db.prepare('UPDATE workspace_memberships SET role=?,is_active=? WHERE workspace_id=? AND user_id=?').run(role,active,actor.workspaceId,target.user_id);
    logEvent('workspace_member_updated',{category:'user_mgmt',actorUserId:req.user.id,targetUserId:target.user_id,metadata:{workspaceId:actor.workspaceId,role,isActive:!!active}});
    sendLiveEvent([target.user_id],'rows_changed',req.user.id);
    res.json({success:true});
  });

  app.get('/api/settings',authenticateToken,(req:any,res)=>{
    const member=context(req,res); if(!member)return;
    const personal=db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id) as any;
    const workspace=db.prepare('SELECT * FROM workspace_settings WHERE workspace_id=?').get(member.workspaceId) as any;
    const notified=json(workspace?.notified_ids,[]);
    const visibleIds=!canSeeAllWorkspaceTrips(member)?new Set(workspaceRows(db,req.user.id).map(row=>row.id)):null;
    res.json({...json(personal?.extra_settings,{}),workspace:member,fontSize:personal?.font_size??100,
      tgConfig:canManage(member.role)?decryptJson(workspace?.tg_config,null):null,
      templates:json(workspace?.templates,[]),alertSettings:json(workspace?.alert_settings,null),
      // The database trash endpoint is authoritative; legacy mirrors may retain revoked shares.
      deletedRows:[],notifiedIds:Array.isArray(notified)?notified.filter(id=>!visibleIds||visibleIds.has(id)):[],
      integrationReviewRequired:Boolean(workspace?.integration_review_required)});
  });
  app.post('/api/settings',authenticateToken,(req:any,res)=>{
    const member=context(req,res); if(!member)return;
    const workspaceFields=['tgConfig','templates','alertSettings'];
    if((workspaceFields.some(key=>req.body[key]!==undefined)||req.body.resolveIntegrationReview===true)&&!canManage(member.role))return fail(res,'WORKSPACE_FORBIDDEN','Workspace settings require owner or manager access');
    if(req.body.deletedRows!==undefined&&member.role==='viewer')return fail(res,'WORKSPACE_READ_ONLY','Viewer access is read only');
    // The legacy trash mirror cannot introduce rows from a foreign workspace.
    const deletedRows=req.body.deletedRows;
    if(deletedRows!==undefined&&(!Array.isArray(deletedRows)||deletedRows.some((row:any)=>!row?.id||!workspaceRowAccess(db,req.user.id,String(row.id)))))return fail(res,'WORKSPACE_FORBIDDEN','Trash contains an unauthorized row');
    const personal=db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id) as any;
    const extra=json(personal?.extra_settings,{});
    db.transaction(()=>{
      db.prepare(`INSERT INTO settings(user_id,font_size,extra_settings,deleted_rows) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET font_size=excluded.font_size,extra_settings=excluded.extra_settings,deleted_rows=excluded.deleted_rows`)
        .run(req.user.id,req.body.fontSize??personal?.font_size??100,JSON.stringify({
          previewSettings:req.body.previewSettings??extra.previewSettings,displaySettings:req.body.displaySettings??extra.displaySettings,
        }),deletedRows===undefined?personal?.deleted_rows??null:JSON.stringify(deletedRows));
      const current=db.prepare('SELECT * FROM workspace_settings WHERE workspace_id=?').get(member.workspaceId) as any;
      db.prepare(`UPDATE workspace_settings SET tg_config=?,templates=?,alert_settings=?,integration_review_required=? WHERE workspace_id=?`)
        .run(req.body.tgConfig===undefined?current?.tg_config??null:req.body.tgConfig?encryptJson(req.body.tgConfig):null,
          req.body.templates===undefined?current?.templates??null:JSON.stringify(req.body.templates),
          req.body.alertSettings===undefined?current?.alert_settings??null:JSON.stringify(req.body.alertSettings),
          req.body.resolveIntegrationReview===true?0:current?.integration_review_required??0,member.workspaceId);
    })();
    if(req.body.tgConfig!==undefined)logEvent('telegram_config_updated',{category:'settings',actorUserId:req.user.id,metadata:{workspaceId:member.workspaceId}});
    res.json({success:true});
  });

  app.post('/api/shares/invitations',authenticateToken,(req:any,res)=>{
    const member=context(req,res); if(!member)return;
    const scope=req.body.scopeType;
    if(!['row','group','agency'].includes(scope))return fail(res,'INVALID_SCOPE','Invalid share scope',400);
    const source=Number(req.body.sourceWorkspaceId??member.workspaceId);
    const value=String(scope==='row'?req.body.rowId??'':scope==='group'?req.body.groupNo??'':req.body.agency??'').trim();
    if(!value||value.length>200)return fail(res,'INVALID_SCOPE','A valid share scope is required',400);
    if(!sourceAuthorized(req.user.id,source,scope,value))return fail(res,'WORKSPACE_FORBIDDEN','This sharing scope requires company manager authority or ownership of the trip');
    const recipient=db.prepare('SELECT id FROM users WHERE username=? AND is_active=1').get(String(req.body.receiverUsername||'').trim().toLowerCase()) as any;
    if(!recipient||!workspaceForUser(db,recipient.id))return fail(res,'RECIPIENT_NOT_FOUND','Active recipient not found',404);
    if(recipient.id===req.user.id)return fail(res,'INVALID_RECIPIENT','Cannot share with yourself',400);
    const matches=workspaceRows(db,req.user.id).some((r:any)=>r.workspace_id===source&&(scope==='row'?r.id===value:scope==='group'?String(json(r.data,{}).groupNo||'')===value:String(json(r.data,{}).agency||'').trim()===value));
    if(!matches)return fail(res,'SCOPE_NOT_FOUND','Source trip scope not found',404);
    const role=req.body.role==='viewer'?'viewer':'editor';
    const existing=db.prepare("SELECT * FROM workspace_share_invitations WHERE source_workspace_id=? AND scope_type=? AND scope_value=? AND receiver_user_id=? AND status='pending'").get(source,scope,value,recipient.id) as any;
    let id=existing?.id;
    if(!id)id=Number(db.prepare('INSERT INTO workspace_share_invitations(source_workspace_id,sender_user_id,receiver_user_id,scope_type,scope_value,role) VALUES (?,?,?,?,?,?)').run(source,req.user.id,recipient.id,scope,value,role).lastInsertRowid);
    sendLiveEvent([recipient.id],'invitations_changed',req.user.id);
    logEvent('share_invitation_created',{category:'sharing',actorUserId:req.user.id,targetUserId:recipient.id,metadata:{sourceWorkspaceId:source,scopeType:scope,role}});
    res.json({success:true,invitation:inviteView(db.prepare('SELECT * FROM workspace_share_invitations WHERE id=?').get(id))});
  });
  app.get('/api/shares/invitations',authenticateToken,(req:any,res)=>{
    res.json((db.prepare(`SELECT i.*,u.username AS sender_username FROM workspace_share_invitations i JOIN users u ON u.id=i.sender_user_id
      WHERE i.receiver_user_id=? AND i.status='pending' ORDER BY i.id DESC`).all(req.user.id) as any[]).map(inviteView));
  });
  for(const action of ['accept','decline'])app.post(`/api/shares/invitations/:id/${action}`,authenticateToken,(req:any,res)=>{
    const invite=db.prepare("SELECT * FROM workspace_share_invitations WHERE id=? AND receiver_user_id=? AND status='pending'").get(Number(req.params.id),req.user.id) as any;
    if(!invite)return fail(res,'INVITATION_NOT_FOUND','Invitation not found',404);
    if(action==='accept'){
      const member=context(req,res); if(!member)return;
      if(!sourceAuthorized(invite.sender_user_id,invite.source_workspace_id,invite.scope_type,invite.scope_value))return fail(res,'WORKSPACE_FORBIDDEN','Sharing authority is no longer active');
      if(invite.scope_type==='row'){
        const record=db.prepare('SELECT workspace_id FROM logistics_rows WHERE id=?').get(invite.scope_value) as any;
        if(record?.workspace_id!==invite.source_workspace_id)return fail(res,'SCOPE_NOT_FOUND','Trip no longer exists',404);
      }
    }
    db.transaction(()=>{
      if(action==='accept')db.prepare(`INSERT INTO workspace_grants(source_workspace_id,scope_type,scope_value,row_id,user_id,granted_by_user_id,role)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_workspace_id,scope_type,scope_value,user_id) DO UPDATE SET role=excluded.role,granted_by_user_id=excluded.granted_by_user_id`)
        .run(invite.source_workspace_id,invite.scope_type,invite.scope_value,invite.scope_type==='row'?invite.scope_value:null,req.user.id,invite.sender_user_id,invite.role);
      db.prepare('UPDATE workspace_share_invitations SET status=?,responded_at=CURRENT_TIMESTAMP WHERE id=?').run(action==='accept'?'accepted':'declined',invite.id);
    })();
    sendLiveEvent([invite.sender_user_id,req.user.id],'invitations_changed',req.user.id);
    sendLiveEvent(notifications(invite.source_workspace_id,invite.scope_type,invite.scope_value),'rows_changed',req.user.id);
    logEvent(`share_invitation_${action==='accept'?'accepted':'declined'}`,{category:'sharing',actorUserId:req.user.id,targetUserId:invite.sender_user_id,metadata:{sourceWorkspaceId:invite.source_workspace_id}});
    res.json({success:true});
  });
  app.get('/api/shares/access',authenticateToken,(req:any,res)=>{
    const member=context(req,res); if(!member)return;
    if(member.role==='viewer')return res.json([]);
    const companyWide=canSeeAllWorkspaceTrips(member);
    res.json((db.prepare(`SELECT g.*,u.username FROM workspace_grants g JOIN users u ON u.id=g.user_id WHERE source_workspace_id=?
      ${companyWide?'':"AND (g.granted_by_user_id=? OR (g.scope_type='row' AND EXISTS(SELECT 1 FROM logistics_rows r WHERE r.id=g.row_id AND r.user_id=?)))"}
      ORDER BY g.created_at DESC`).all(...(companyWide?[member.workspaceId]:[member.workspaceId,req.user.id,req.user.id])) as any[]).map(g=>({
      sourceWorkspaceId:g.source_workspace_id,scopeType:g.scope_type,rowId:g.scope_type==='row'?g.scope_value:undefined,
      groupNo:g.scope_type==='group'?g.scope_value:undefined,agency:g.scope_type==='agency'?g.scope_value:undefined,
      userId:g.user_id,username:g.username,role:g.role,createdAt:g.created_at,rowSummary:g.scope_type==='row'?'Shared trip':g.scope_value,
    })));
  });
  for(const method of ['patch','delete'] as const)app[method]('/api/shares/access',authenticateToken,(req:any,res)=>{
    const member=context(req,res); if(!member)return;
    const source=Number(req.body.sourceWorkspaceId??member.workspaceId);
    const scope=req.body.scopeType,value=String(scope==='row'?req.body.rowId??'':scope==='group'?req.body.groupNo??'':req.body.agency??'').trim();
    if(!sourceAuthorized(req.user.id,source,scope,value))return fail(res,'WORKSPACE_FORBIDDEN','Source workspace sharing authority required');
    const recipient=Number(req.body.userId);
    const before=notifications(source,scope,value);
    const result=method==='patch'?db.prepare('UPDATE workspace_grants SET role=? WHERE source_workspace_id=? AND scope_type=? AND scope_value=? AND user_id=?').run(req.body.role==='viewer'?'viewer':'editor',source,scope,value,recipient)
      :db.prepare('DELETE FROM workspace_grants WHERE source_workspace_id=? AND scope_type=? AND scope_value=? AND user_id=?').run(source,scope,value,recipient);
    if(!result.changes)return fail(res,'ACCESS_NOT_FOUND','Access not found',404);
    sendLiveEvent(before,'rows_changed',req.user.id);
    logEvent(method==='patch'?'share_access_updated':'share_access_revoked',{category:'sharing',actorUserId:req.user.id,targetUserId:recipient,metadata:{sourceWorkspaceId:source,scopeType:scope}});
    res.json({success:true});
  });
  app.get('/api/admin/workspaces',authenticateToken,requireAdmin,(_req,res)=>res.json({workspaces:db.prepare(`SELECT c.id,c.name,
    (SELECT COUNT(*) FROM workspace_memberships m WHERE m.workspace_id=c.id) AS memberCount FROM companies c ORDER BY c.id`).all()}));
  app.post('/api/alerts/trigger',authenticateToken,requireAdmin,async(_req,res)=>{
    await deps.checkAndSendAlerts(); res.json({success:true});
  });
}
