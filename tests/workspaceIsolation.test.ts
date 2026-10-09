import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { changeSubscription } from '../server/subscriptions';

vi.hoisted(() => { process.env.WORKSPACE_TEST_MODE = 'true'; });
const { app, db, attachLiveUpdates, checkAndSendAlerts } = await import('../server');
let adminToken = '';
let serial = 0;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => {
  const login = await request(app).post('/api/auth/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  adminToken = login.body.token;
});
const user = async (companyId?: number) => {
  const username = `workspace_${++serial}_${Date.now()}`;
  const created = await request(app).post('/api/admin/users').set(auth(adminToken)).send({ username, password: 'Password123!', companyId });
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ username, password: 'Password123!' });
  expect(login.status,JSON.stringify({error:login.body.error,userId:created.body.user.id})).toBe(200);
  expect(login.body.user.id).toBe(created.body.user.id);
  return { id: created.body.user.id as number, username, token: login.body.token as string, refreshToken:login.body.refreshToken as string };
};
const row = (id: string) => ({ id, groupNo: '100', groupName: 'Synthetic', agency: 'Example', status: 'Planned', notes: '' });
const save = (token: string, rows: any[]) => request(app).post('/api/data/sync').set(auth(token)).send({ rows });
const saveSettings = async (token:string,payload:Record<string,unknown>) => {
  const context=await request(app).get('/api/workspace').set(auth(token));
  return request(app).post('/api/settings').set(auth(token)).send({workspaceId:context.body.workspaceId,...payload});
};
const rowsFor = (token: string) => request(app).get('/api/data').set(auth(token));
const share = async (sender: Awaited<ReturnType<typeof user>>, receiver: Awaited<ReturnType<typeof user>>, scopeType = 'group', role = 'editor') => {
  const invite = await request(app).post('/api/shares/invitations').set(auth(sender.token)).send({ receiverUsername: receiver.username, scopeType, groupNo: '100', agency: 'Example', role });
  expect(invite.status,JSON.stringify({error:invite.body.error,code:invite.body.code,sender:sender.id,member:db.prepare('SELECT workspace_id,role,is_active FROM workspace_memberships WHERE user_id=?').get(sender.id)})).toBe(200);
  const accepted = await request(app).post(`/api/shares/invitations/${invite.body.invitation.id}/accept`).set(auth(receiver.token)).send();
  expect(accepted.status,JSON.stringify({error:accepted.body.error,code:accepted.body.code,recipient:receiver.id,member:db.prepare('SELECT workspace_id,role,is_active FROM workspace_memberships WHERE user_id=?').get(receiver.id)})).toBe(200);
  return invite.body.invitation;
};

describe('staging workspace ownership and isolation', () => {
  it('rejects ordinary company deletion when immutable subscription history exists',async()=>{
    const company=await request(app).post('/api/admin/companies').set(auth(adminToken)).send({name:`audited_subscription_${Date.now()}`});
    const admin=db.prepare("SELECT id FROM users WHERE role='admin'").get() as {id:number};
    const now=new Date().toISOString();
    changeSubscription(db,{workspaceId:company.body.company.id,actorUserId:admin.id,expectedRevision:0,requestId:'synthetic-activation',reason:'Synthetic approved agreement',
      action:{type:'activate',startsAt:now,planLabel:'Synthetic annual',seatLimit:1,graceDays:0}},now);
    const response=await request(app).delete(`/api/admin/companies/${company.body.company.id}`).set(auth(adminToken));
    expect(response.status).toBe(400);
    expect(db.prepare('SELECT 1 FROM subscription_events WHERE workspace_id=?').get(company.body.company.id)).toBeDefined();
  });
  it('creates pending subscription storage for new companies and personal workspaces without blocking trips',async()=>{
    const company=await request(app).post('/api/admin/companies').set(auth(adminToken)).send({name:`subscription_${Date.now()}`});
    expect(company.status).toBe(201);
    expect(db.prepare('SELECT starts_at,seat_limit FROM workspace_subscriptions WHERE workspace_id=?').get(company.body.company.id)).toEqual({starts_at:null,seat_limit:null});
    const account=await user();
    const membership=db.prepare('SELECT workspace_id FROM workspace_memberships WHERE user_id=?').get(account.id) as any;
    expect(db.prepare('SELECT starts_at FROM workspace_subscriptions WHERE workspace_id=?').get(membership.workspace_id)).toEqual({starts_at:null});
    expect((await save(account.token,[row('pending-storage-trip')])).status).toBe(200);
    expect((await request(app).delete(`/api/admin/companies/${company.body.company.id}`).set(auth(adminToken))).status).toBe(200);
  });
  it('prevents archived creator records from being reactivated or given usable sessions',async()=>{
    const account=await user();
    db.prepare('UPDATE users SET is_archived_creator=1,is_active=0 WHERE id=?').run(account.id);
    expect((await request(app).patch(`/api/admin/users/${account.id}`).set(auth(adminToken)).send({isActive:true})).status).toBe(400);
    expect((await request(app).post(`/api/admin/users/${account.id}/reset-password`).set(auth(adminToken)).send({password:'AnotherPassword123!'})).status).toBe(400);
    // Even an inconsistent database active flag cannot revive a historical identity.
    db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(account.id);
    expect((await rowsFor(account.token)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({refreshToken:account.refreshToken})).status).toBe(401);
    const login=await request(app).post('/api/auth/login').send({username:account.username,password:'Password123!'});
    expect(login.body.token).toBeUndefined();
  });
  it('does not expose cached trash contents after a share is revoked', async () => {
    const source=await user(); const recipient=await user();
    await save(source.token,[row('revoked-trash')]); await share(source,recipient);
    db.prepare('INSERT INTO settings(user_id,deleted_rows) VALUES (?,?)').run(recipient.id,JSON.stringify([{...row('revoked-trash'),notes:'private cached contents'}]));
    await request(app).delete('/api/shares/access').set(auth(source.token)).send({scopeType:'group',groupNo:'100',userId:recipient.id});
    expect((await request(app).get('/api/settings').set(auth(recipient.token))).body.deletedRows).toEqual([]);
  });

  it('overwrites only the importing workspace despite an editable external group with the same number',async()=>{
    const source=await user();const importer=await user();
    await save(source.token,[row('external-import')]);await share(source,importer);
    await save(importer.token,[row('own-import')]);
    const imported=await request(app).post('/api/ingest/text').set(auth(importer.token)).send({text:'رحلة الوصول\nتاريخ الوصول\n15/01/2026\nوقت الوصول\n14:30\nرقم الرحلة\nSV123\nالمطار\nمطار الملك عبد العزيز',groupNo:'100',groupName:'Synthetic',count:'2',overwrite:true});
    expect(imported.status).toBe(200);
    expect((db.prepare('SELECT deleted_at FROM logistics_rows WHERE id=?').get('external-import') as any).deleted_at).toBeNull();
    expect((db.prepare('SELECT deleted_at FROM logistics_rows WHERE id=?').get('own-import') as any).deleted_at).not.toBeNull();
  });

  it.each(['single','bulk','all'])('lets workspace owners purge offboarded employee trash through the %s endpoint',async(mode)=>{
    const owner=await user();const workspace=(await request(app).get('/api/workspace').set(auth(owner.token))).body;
    const employee=await user(workspace.workspaceId);const id=`offboarded-purge-${mode}`;
    await save(employee.token,[row(id)]);
    await request(app).post(`/api/data/${id}/delete`).set(auth(employee.token)).send();
    await request(app).patch(`/api/admin/users/${employee.id}`).set(auth(adminToken)).send({isActive:false});
    const result=mode==='single'?await request(app).delete(`/api/data/${id}`).set(auth(owner.token)):mode==='bulk'?await request(app).post('/api/data/bulk').set(auth(owner.token)).send({action:'purge',ids:[id]}):await request(app).delete('/api/data/deleted').set(auth(owner.token));
    expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.failed??[]).toEqual([]);
    expect(db.prepare('SELECT id FROM logistics_rows WHERE id=?').get(id)).toBeUndefined();
  });

  it('preserves integration conflicts through autosaves until explicitly resolved by a manager',async()=>{
    const owner=await user();const workspace=(await request(app).get('/api/workspace').set(auth(owner.token))).body;
    db.prepare('UPDATE workspace_settings SET integration_review_required=1 WHERE workspace_id=?').run(workspace.workspaceId);
    await saveSettings(owner.token,{tgConfig:{enabled:false},alertSettings:{},fontSize:100});
    expect((await request(app).get('/api/settings').set(auth(owner.token))).body.integrationReviewRequired).toBe(true);
    const editor=await user(workspace.workspaceId);
    expect((await saveSettings(editor.token,{resolveIntegrationReview:true})).status).toBe(403);
    await saveSettings(owner.token,{tgConfig:{enabled:false},resolveIntegrationReview:true});
    expect((await request(app).get('/api/settings').set(auth(owner.token))).body.integrationReviewRequired).toBe(false);
  });

  it.each(['patch','sync','create'])('delivers relevant live invalidations for %s writes, including former scope recipients',async(mode)=>{
    const source=await user();const workspace=(await request(app).get('/api/workspace').set(auth(source.token))).body;
    const recipient=await user(mode==='create'?workspace.workspaceId:undefined);const id=`scope-change-${mode}`;
    if(mode!=='create'){await save(source.token,[row(id)]);await share(source,recipient);}
    const server=createServer(app);const wss=attachLiveUpdates(server);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error('No address');
    const ws=new WebSocket(`ws://127.0.0.1:${address.port}/api/live?token=${recipient.token}`);
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const events:any[]=[];ws.on('message',value=>events.push(JSON.parse(String(value))));
    try{
      const result=mode==='create'?await save(source.token,[{...row(id),groupNo:'',agency:''}]):mode==='patch'?await request(app).patch(`/api/data/${id}`).set(auth(recipient.token)).send({updates:{groupNo:'200'}}):await save(recipient.token,[{...row(id),groupNo:'200'}]);
      expect(result.status).toBe(200);
      if(mode==='patch')expect(result.body.row).toBeNull();
      await new Promise<void>(resolve=>{ws.once('pong',()=>resolve());ws.ping();});
      expect(events.some(e=>e.type==='rows_changed')).toBe(true);
      const rows=(await rowsFor(recipient.token)).body;
      if(mode==='create')expect(rows.map((row:any)=>row.id)).toContain(id);
      else expect(rows).toEqual([]);
    }finally{ws.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });

  it('returns membership context and provisions an isolated workspace for an unassigned customer', async () => {
    const account = await user();
    const context = await request(app).get('/api/workspace').set(auth(account.token));
    expect(context.status).toBe(200);
    expect(context.body).toMatchObject({ role: 'owner', userId: account.id });
    expect(context.body.workspaceId).toBeGreaterThan(0);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it.each(['group', 'agency'])('shares only the source workspace when companies use identical %s values', async scope => {
    const a = await user(); const b = await user(); const recipient = await user();
    await save(a.token, [row(`a-${serial}`)]); await save(b.token, [row(`b-${serial}`)]);
    await share(a, recipient, scope);
    const visible = await rowsFor(recipient.token);
    expect(visible.body.map((r: any) => r.id)).toEqual([`a-${serial}`]);
    const duplicate = await request(app).get('/api/check/group/100').set(auth(recipient.token));
    expect(duplicate.body).toEqual({ exists: true, count: 1 });
    expect((await rowsFor(b.token)).body.map((r: any) => r.id)).toEqual([`b-${serial}`]);
  });

  it('lists company-owned trips to another employee and preserves creator identity', async () => {
    const owner = await user();
    const context = await request(app).get('/api/workspace').set(auth(owner.token));
    const employee = await user(context.body.workspaceId);
    await save(employee.token, [row('employee-trip')]);
    expect((await rowsFor(owner.token)).body.map((r: any) => r.id)).toContain('employee-trip');
    const stored: any = db.prepare('SELECT user_id, workspace_id FROM logistics_rows WHERE id = ?').get('employee-trip');
    expect(stored).toEqual({ user_id: employee.id, workspace_id: context.body.workspaceId });
  });

  it('rejects forged workspace IDs on sync before making changes', async () => {
    const a = await user(); const b = await user();
    const target = await request(app).get('/api/workspace').set(auth(b.token));
    const result = await save(a.token, [{ ...row('forged'), workspaceId: target.body.workspaceId }]);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('WORKSPACE_FORBIDDEN');
    expect(db.prepare('SELECT id FROM logistics_rows WHERE id = ?').get('forged')).toBeUndefined();
  });

  it('denies foreign row mutation, restoration, purge and bulk operations', async () => {
    const a = await user(); const b = await user();
    await save(a.token, [row('private-row')]);
    expect((await request(app).patch('/api/data/private-row').set(auth(b.token)).send({ updates: { notes: 'attack' } })).status).not.toBe(200);
    await request(app).post('/api/data/private-row/delete').set(auth(a.token)).send();
    await request(app).post('/api/data/private-row/restore').set(auth(b.token)).send();
    await request(app).delete('/api/data/private-row').set(auth(b.token)).send();
    await request(app).post('/api/data/bulk').set(auth(b.token)).send({ action: 'restore', ids: ['private-row'] });
    const stored: any = db.prepare('SELECT deleted_at, data FROM logistics_rows WHERE id = ?').get('private-row');
    expect(stored.deleted_at).not.toBeNull();
    expect(JSON.parse(stored.data).notes).toBe('');
    expect((await request(app).get('/api/data/deleted').set(auth(b.token))).body).toEqual([]);
  });

  it('keeps newly created recipient trips in the recipient workspace rather than assigning by a shared label', async () => {
    const a = await user(); const recipient = await user();
    await save(a.token, [row('source-shared')]); await share(a, recipient);
    await save(recipient.token, [row('recipient-own')]);
    expect((await rowsFor(a.token)).body.map((r: any) => r.id)).not.toContain('recipient-own');
    const ids = (await rowsFor(recipient.token)).body.map((r: any) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['source-shared', 'recipient-own']));
  });

  it('revokes disabled employee access immediately without losing workspace trips', async () => {
    const owner = await user();
    const context = await request(app).get('/api/workspace').set(auth(owner.token));
    const employee = await user(context.body.workspaceId);
    await save(employee.token, [row('offboarding-trip')]);
    await request(app).patch(`/api/admin/users/${employee.id}`).set(auth(adminToken)).send({ isActive: false });
    expect((await rowsFor(employee.token)).status).toBe(401);
    expect((await rowsFor(owner.token)).body.map((r: any) => r.id)).toContain('offboarding-trip');
    expect(db.prepare('SELECT user_id FROM workspace_memberships WHERE user_id = ?').get(employee.id)).toBeDefined();
  });

  it('prevents workspace viewers from creating/editing trips even when an external editor grant exists', async () => {
    const a = await user(); const viewer = await user();
    await save(a.token, [row('viewer-shared')]); await share(a, viewer);
    db.prepare("UPDATE workspace_memberships SET role = 'viewer' WHERE user_id = ?").run(viewer.id);
    expect((await save(viewer.token, [row('viewer-new')])).status).toBe(403);
    expect((await request(app).patch('/api/data/viewer-shared').set(auth(viewer.token)).send({ updates: { notes: 'attack' } })).status).toBe(403);
    expect((await rowsFor(viewer.token)).body.map((r: any) => r.id)).toContain('viewer-shared');
  });

  it('rechecks source authority before accepting an invitation', async () => {
    const a = await user(); const b = await user();
    await save(a.token, [row('stale-invite')]);
    const invite = await request(app).post('/api/shares/invitations').set(auth(a.token)).send({ receiverUsername: b.username, scopeType: 'group', groupNo: '100' });
    await request(app).patch(`/api/admin/users/${a.id}`).set(auth(adminToken)).send({ isActive: false });
    expect((await request(app).post(`/api/shares/invitations/${invite.body.invitation.id}/accept`).set(auth(b.token)).send()).status).toBe(403);
    expect((await rowsFor(b.token)).body).toEqual([]);
  });

  it('does not use globally keyed legacy grants for staging access', async () => {
    const a = await user(); const b = await user();
    await save(a.token, [row('legacy-global')]);
    db.prepare("INSERT INTO trip_group_access (group_no,user_id,granted_by_user_id,role) VALUES ('100',?,?,'editor')").run(b.id,a.id);
    expect((await rowsFor(b.token)).body).toEqual([]);
  });

  it('purges a row-level shared trip without leaving a foreign-key failure or live grant', async () => {
    const a=await user(); const b=await user();
    await save(a.token,[row('purge-row-grant')]);
    const invite=await request(app).post('/api/shares/invitations').set(auth(a.token)).send({receiverUsername:b.username,scopeType:'row',rowId:'purge-row-grant'});
    await request(app).post(`/api/shares/invitations/${invite.body.invitation.id}/accept`).set(auth(b.token)).send();
    await request(app).post('/api/data/purge-row-grant/delete').set(auth(a.token)).send();
    expect((await request(app).delete('/api/data/purge-row-grant').set(auth(a.token)).send()).status).toBe(200);
    expect((await rowsFor(b.token)).body).toEqual([]);
    expect(db.prepare("SELECT 1 FROM workspace_grants WHERE scope_value='purge-row-grant'").get()).toBeUndefined();
  });

  it('keeps integration settings shared within the workspace and personal preferences per account', async () => {
    const a=await user();
    const workspace=(await request(app).get('/api/workspace').set(auth(a.token))).body;
    const b=await user(workspace.workspaceId);
    await saveSettings(a.token,{tgConfig:{token:'synthetic-bot',chatId:'synthetic-chat',enabled:false},fontSize:120});
    await saveSettings(b.token,{fontSize:95});
    const ownerSettings=(await request(app).get('/api/settings').set(auth(a.token))).body;
    const editorSettings=(await request(app).get('/api/settings').set(auth(b.token))).body;
    expect(ownerSettings).toMatchObject({fontSize:120,tgConfig:{token:'synthetic-bot'}});
    expect(editorSettings).toMatchObject({fontSize:95,tgConfig:null});
    expect((await saveSettings(b.token,{tgConfig:{token:'attack'}})).status).toBe(403);
  });

  it('keeps workspace live events isolated and closes a disabled employee socket',async()=>{
    const a=await user();const b=await user();
    await save(a.token,[row('socket-isolation')]);
    const server=createServer(app);const wss=attachLiveUpdates(server);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error('No test server address');
    const connect=async(token:string)=>{
      const ws=new WebSocket(`ws://127.0.0.1:${address.port}/api/live?token=${encodeURIComponent(token)}`);
      await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return ws;
    };
    const source=await connect(a.token);const foreign=await connect(b.token);const foreignEvents:any[]=[];
    foreign.on('message',value=>foreignEvents.push(JSON.parse(String(value))));
    try{
      const received=new Promise<void>(resolve=>source.once('message',()=>resolve()));
      await request(app).patch('/api/data/socket-isolation').set(auth(a.token)).send({updates:{notes:'authorized'}});
      await received;
      await new Promise<void>(resolve=>{foreign.once('pong',()=>resolve());foreign.ping();});
      expect(foreignEvents).toEqual([]);
      const closed=new Promise<number>(resolve=>source.once('close',code=>resolve(code)));
      await request(app).patch(`/api/admin/users/${a.id}`).set(auth(adminToken)).send({isActive:false});
      expect(await closed).toBe(1008);
    }finally{
      source.terminate();foreign.terminate();
      await new Promise<void>(resolve=>wss.close(()=>resolve()));
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });

  it('limits scheduled alerts to source workspace live rows and deduplicates across employees',async()=>{
    const owner=await user();
    const workspace=(await request(app).get('/api/workspace').set(auth(owner.token))).body;
    const employee=await user(workspace.workspaceId);
    await saveSettings(owner.token,{tgConfig:{token:'synthetic-worker-bot',chatId:'synthetic-worker-chat',enabled:true}});
    const soon=new Date(Date.now()+10*60_000);
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(soon);
    const part=(name:string)=>parts.find(p=>p.type===name)!.value;
    const trip={...row('worker-live'),date:`${part('day')}/${part('month')}/${part('year')}`,time:`${part('hour')}:${part('minute')}`,Column1:'وصول',flight:'SYNTHETIC',from:'Test',to:'Test',count:'1'};
    await save(employee.token,[trip,{...trip,id:'worker-deleted'}]);
    await request(app).post('/api/data/worker-deleted/delete').set(auth(employee.token)).send();
    const fetchMock=vi.fn().mockResolvedValue({json:async()=>({ok:true})});
    vi.stubGlobal('fetch',fetchMock);
    try{
      await checkAndSendAlerts();await checkAndSendAlerts();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const stored:any=db.prepare('SELECT notified_ids FROM workspace_settings WHERE workspace_id=?').get(workspace.workspaceId);
      expect(JSON.parse(stored.notified_ids)).toEqual(['worker-live']);
    }finally{vi.unstubAllGlobals();}
  });
});
