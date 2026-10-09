import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import WebSocket from 'ws';

vi.hoisted(()=>{process.env.WORKSPACE_TEST_MODE='true';});
const {app,db,attachLiveUpdates}=await import('../server');
let adminToken='',serial=0;
const auth=(token:string)=>({Authorization:`Bearer ${token}`});
beforeAll(async()=>{
  adminToken=(await request(app).post('/api/auth/login').send({username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD})).body.token;
});
const account=async(companyId?:number)=>{
  const username=`sharing_${++serial}`;
  const response=await request(app).post('/api/admin/users').set(auth(adminToken)).send({username,password:'SyntheticPassword123!',companyId});
  expect(response.status,JSON.stringify(response.body)).toBe(201);
  const token=(await request(app).post('/api/auth/login').send({username,password:'SyntheticPassword123!'})).body.token;
  return {id:response.body.user.id as number,username,token:token as string};
};
const fixture=async()=>{
  const owner=await account();
  const workspace=(await request(app).get('/api/workspace').set(auth(owner.token))).body;
  const editor=await account(workspace.workspaceId),peer=await account(workspace.workspaceId);
  const prefix=`company-${serial}`;
  const trip=(id:string)=>({id,groupNo:'100',agency:'Example',groupName:'Synthetic',status:'Planned',notes:''});
  const ownerRow=trip(`${prefix}-owner`),editorRow=trip(`${prefix}-editor`),peerRow=trip(`${prefix}-peer`);
  for(const [user,row] of [[owner,ownerRow],[editor,editorRow],[peer,peerRow]] as const)
    expect((await request(app).post('/api/data/sync').set(auth(user.token)).send({rows:[row]})).status).toBe(200);
  const toggle=(enabled:boolean,token=adminToken)=>request(app).patch(`/api/admin/companies/${workspace.workspaceId}/trip-sharing`).set(auth(token)).send({shareAllTrips:enabled});
  const ids=async(token:string,deleted=false)=>(await request(app).get(`/api/data${deleted?'/deleted':''}`).set(auth(token))).body.map((r:any)=>r.id).sort();
  return {owner,editor,peer,workspace,ownerRow,editorRow,peerRow,toggle,ids};
};
describe('per-company automatic trip sharing',()=>{
  it('defaults to ON and persists toggles without changing historic trips',async()=>{
    const f=await fixture();
    const list=(await request(app).get('/api/admin/companies').set(auth(adminToken))).body.companies;
    expect(list.find((c:any)=>c.id===f.workspace.workspaceId).shareAllTrips).toBe(true);
    expect(await f.ids(f.editor.token)).toEqual([f.ownerRow.id,f.editorRow.id,f.peerRow.id].sort());
    const before=db.prepare('SELECT * FROM logistics_rows WHERE workspace_id=? ORDER BY id').all(f.workspace.workspaceId);
    expect((await f.toggle(false)).status).toBe(200);
    expect((await f.toggle(false)).status).toBe(200);
    expect(db.prepare('SELECT * FROM logistics_rows WHERE workspace_id=? ORDER BY id').all(f.workspace.workspaceId)).toEqual(before);
    expect((await request(app).get('/api/workspace').set(auth(f.editor.token))).body.shareAllTrips).toBe(false);
    expect((await f.toggle(true)).status).toBe(200);
    expect(await f.ids(f.editor.token)).toHaveLength(3);
  });
  it('OFF keeps managers/owners fully visible while editors and viewers see only their own trips',async()=>{
    const f=await fixture();
    expect((await request(app).patch(`/api/workspace/members/${f.peer.id}`).set(auth(f.owner.token)).send({role:'manager'})).status).toBe(200);
    expect((await f.toggle(false)).status).toBe(200);
    expect(await f.ids(f.editor.token)).toEqual([f.editorRow.id]);
    expect(await f.ids(f.peer.token)).toHaveLength(3);
    expect(await f.ids(f.owner.token)).toHaveLength(3);
    await request(app).patch(`/api/workspace/members/${f.editor.id}`).set(auth(f.owner.token)).send({role:'viewer'});
    expect(await f.ids(f.editor.token)).toEqual([f.editorRow.id]);
    expect((await request(app).patch(`/api/data/${f.editorRow.id}`).set(auth(f.editor.token)).send({updates:{notes:'forbidden'}})).status).toBe(403);
  });
  it('prevents stale-tab mutations, restores and duplicate leaks for hidden trips',async()=>{
    const f=await fixture();
    await request(app).post(`/api/data/${f.ownerRow.id}/delete`).set(auth(f.owner.token));
    expect((await f.toggle(false)).status).toBe(200);
    expect(await f.ids(f.editor.token,true)).toEqual([]);
    expect([403,404]).toContain((await request(app).patch(`/api/data/${f.peerRow.id}`).set(auth(f.editor.token)).send({updates:{notes:'intrusion'}})).status);
    // Invisible restore keeps the existing non-enumerating, idempotent no-op response.
    const restore=await request(app).post(`/api/data/${f.ownerRow.id}/restore`).set(auth(f.editor.token));
    expect(restore.body).toEqual({success:true,alreadyRestored:true});
    expect((db.prepare('SELECT deleted_at FROM logistics_rows WHERE id=?').get(f.ownerRow.id) as any).deleted_at).not.toBeNull();
    const before=db.prepare('SELECT * FROM logistics_rows WHERE id=?').get(f.peerRow.id);
    expect((await request(app).post('/api/data/sync').set(auth(f.editor.token)).send({rows:[{...f.peerRow,notes:'intrusion'}]})).status).toBe(200);
    expect(db.prepare('SELECT * FROM logistics_rows WHERE id=?').get(f.peerRow.id)).toEqual(before);
    const duplicates=await request(app).get('/api/check/group/100').set(auth(f.editor.token));
    expect(duplicates.status).toBe(200);expect(duplicates.body).toEqual({exists:true,count:1});
    expect((db.prepare('SELECT data FROM logistics_rows WHERE id=?').get(f.peerRow.id) as any).data).not.toContain('intrusion');
  });
  it('preserves explicit row sharing when automatic sharing is OFF and retains viewer limits',async()=>{
    const f=await fixture();expect((await f.toggle(false)).status).toBe(200);
    const invitation=await request(app).post('/api/shares/invitations').set(auth(f.owner.token)).send({receiverUsername:f.editor.username,scopeType:'row',rowId:f.peerRow.id,role:'viewer'});
    expect(invitation.status).toBe(200);
    expect((await request(app).post(`/api/shares/invitations/${invitation.body.invitation.id}/accept`).set(auth(f.editor.token))).status).toBe(200);
    expect(await f.ids(f.editor.token)).toEqual([f.editorRow.id,f.peerRow.id].sort());
    expect((await request(app).patch(`/api/data/${f.peerRow.id}`).set(auth(f.editor.token)).send({updates:{notes:'read-only'}})).status).toBe(403);
  });
  it('does not let staff broaden a group or agency share into coworkers private trips',async()=>{
    const f=await fixture();expect((await f.toggle(false)).status).toBe(200);
    for(const scopeType of ['group','agency','row']){
      const invite=await request(app).post('/api/shares/invitations').set(auth(f.editor.token)).send({receiverUsername:f.peer.username,scopeType,groupNo:'100',agency:'Example',rowId:f.ownerRow.id});
      expect(invite.status).toBe(403);
    }
    const own=await request(app).post('/api/shares/invitations').set(auth(f.editor.token)).send({receiverUsername:f.peer.username,scopeType:'row',rowId:f.editorRow.id});
    expect(own.status).toBe(200);
  });
  it('rechecks pending sharing authority after the company toggle changes',async()=>{
    const f=await fixture();
    const invite=await request(app).post('/api/shares/invitations').set(auth(f.editor.token)).send({receiverUsername:f.peer.username,scopeType:'row',rowId:f.ownerRow.id});
    expect(invite.status).toBe(200);expect((await f.toggle(false)).status).toBe(200);
    expect((await request(app).post(`/api/shares/invitations/${invite.body.invitation.id}/accept`).set(auth(f.peer.token))).status).toBe(403);
  });
  it('does not expose or mutate coworkers sharing metadata when automatic sharing is OFF',async()=>{
    const f=await fixture();
    const invite=await request(app).post('/api/shares/invitations').set(auth(f.owner.token)).send({receiverUsername:f.peer.username,scopeType:'row',rowId:f.ownerRow.id});
    await request(app).post(`/api/shares/invitations/${invite.body.invitation.id}/accept`).set(auth(f.peer.token));
    expect((await f.toggle(false)).status).toBe(200);
    const access=await request(app).get('/api/shares/access').set(auth(f.editor.token));
    expect(access.body).toEqual([]);
    const revoke=await request(app).delete('/api/shares/access').set(auth(f.editor.token)).send({scopeType:'row',rowId:f.ownerRow.id,userId:f.peer.id});
    expect(revoke.status).toBe(403);
  });
  it('retains intentional group sharing granted before automatic sharing was switched OFF',async()=>{
    const f=await fixture();
    const invite=await request(app).post('/api/shares/invitations').set(auth(f.owner.token)).send({receiverUsername:f.editor.username,scopeType:'group',groupNo:'100',role:'viewer'});
    expect(invite.status).toBe(200);
    expect((await request(app).post(`/api/shares/invitations/${invite.body.invitation.id}/accept`).set(auth(f.editor.token))).status).toBe(200);
    expect((await f.toggle(false)).status).toBe(200);
    expect(await f.ids(f.editor.token)).toHaveLength(3);
    expect((await request(app).patch(`/api/data/${f.peerRow.id}`).set(auth(f.editor.token)).send({updates:{notes:'viewer grant'}})).status).toBe(403);
  });
  it('keeps other companies isolated regardless of the toggle',async()=>{
    const f=await fixture(),foreign=await account();
    for(const enabled of [false,true]){
      expect((await f.toggle(enabled)).status).toBe(200);
      expect(await f.ids(foreign.token)).toEqual([]);
    }
  });
  it('restricts the toggle to platform admins and requires real booleans',async()=>{
    const f=await fixture();
    expect((await f.toggle(false,f.owner.token)).status).toBe(403);
    for(const shareAllTrips of ['false',0,null,undefined])
      expect((await request(app).patch(`/api/admin/companies/${f.workspace.workspaceId}/trip-sharing`).set(auth(adminToken)).send({shareAllTrips})).status).toBe(400);
    expect((await request(app).patch('/api/admin/companies/999999/trip-sharing').set(auth(adminToken)).send({shareAllTrips:false})).status).toBe(404);
  });
  it('hides unauthorized trips and notified IDs in alert diagnostics and settings',async()=>{
    const f=await fixture();expect((await f.toggle(false)).status).toBe(200);
    db.prepare('UPDATE workspace_settings SET notified_ids=? WHERE workspace_id=?').run(JSON.stringify([f.editorRow.id,f.ownerRow.id,f.peerRow.id]),f.workspace.workspaceId);
    const settings=(await request(app).get('/api/settings').set(auth(f.editor.token))).body;
    expect(settings.notifiedIds).toEqual([f.editorRow.id]);
    const debug=(await request(app).get('/api/alerts/debug').set(auth(f.editor.token))).body;
    expect(debug.totalTrips).toBe(1);expect(JSON.stringify(debug)).not.toContain(f.peerRow.id);
  });
  it('invalidates stale live clients on toggle and excludes staff from hidden-trip events afterwards',async()=>{
    const f=await fixture();const server=createServer(app),wss=attachLiveUpdates(server);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));
    const port=(server.address() as any).port;
    const socket=new WebSocket(`ws://127.0.0.1:${port}/api/live?token=${encodeURIComponent(f.editor.token)}`);
    await new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});
    try{
      const invalidation=new Promise<any>(resolve=>socket.once('message',data=>resolve(JSON.parse(String(data)))));
      expect((await f.toggle(false)).status).toBe(200);expect((await invalidation).type).toBe('rows_changed');
      const events:any[]=[];socket.on('message',data=>events.push(JSON.parse(String(data))));
      expect((await request(app).patch(`/api/data/${f.peerRow.id}`).set(auth(f.peer.token)).send({updates:{notes:'private'}})).status).toBe(200);
      await new Promise<void>(resolve=>{socket.once('pong',()=>resolve());socket.ping();});
      expect(events).toEqual([]);
    }finally{
      socket.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
