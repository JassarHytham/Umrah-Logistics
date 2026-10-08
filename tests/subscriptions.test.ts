import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as subscriptions from '../server/subscriptions';

const databases:Database.Database[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
const fixture=()=>{
  const db=new Database(':memory:');databases.push(db);
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
    INSERT INTO schema_migrations VALUES(1),(2);
    CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,is_active INTEGER,is_archived_creator INTEGER);
    CREATE TABLE workspace_memberships(workspace_id INTEGER,user_id INTEGER,is_active INTEGER,role TEXT);
    INSERT INTO companies VALUES(1,'Synthetic A'),(2,'Synthetic B');
    INSERT INTO users VALUES(10,'admin',1,0),(11,'user',1,0),(12,'admin',0,0);
    INSERT INTO workspace_memberships VALUES(1,11,1,'owner');`);
  subscriptions.migrateSubscriptionSchema(db);
  return db;
};
const base={workspaceId:1,actorUserId:10,expectedRevision:0,requestId:'activate-1',reason:'Confirmed external annual arrangement'};
const activation={...base,action:{type:'activate' as const,planLabel:'Annual company',startsAt:'2024-02-29T12:34:56.000Z',seatLimit:3,graceDays:7}};
const activate=(db:Database.Database)=>subscriptions.changeSubscription(db,activation,'2024-02-29T12:34:56.000Z');

describe('contact-managed annual subscription storage',()=>{
  it('adds pending workspace subscriptions idempotently without fabricating active terms',()=>{
    const db=fixture();subscriptions.migrateSubscriptionSchema(db);
    expect(subscriptions.getSubscription(db,1)).toMatchObject({workspaceId:1,startsAt:null,endsAt:null,seatLimit:null,revision:0});
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_subscriptions').get()).toEqual({count:2});
    expect(db.prepare('SELECT COUNT(*) AS count FROM subscription_events').get()).toEqual({count:0});
    expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({version:3});
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it.each([
    ['2024-02-29T12:34:56.789Z','2025-02-28T12:34:56.789Z'],
    ['2023-03-01T02:00:00.000Z','2024-03-01T02:00:00.000Z'],
    ['2026-12-31T23:59:59.000Z','2027-12-31T23:59:59.000Z'],
  ])('calculates a calendar year from %s', (start,end)=>expect(subscriptions.annualEnd(start)).toBe(end));
  it('stores activation and an immutable old/new/actor/reason event atomically',()=>{
    const db=fixture();const record=activate(db);
    expect(record).toMatchObject({startsAt:'2024-02-29T12:34:56.000Z',endsAt:'2025-02-28T12:34:56.000Z',graceEndsAt:'2025-03-07T12:34:56.000Z',seatLimit:3,revision:1});
    const event=db.prepare('SELECT * FROM subscription_events').get() as any;
    expect(event).toMatchObject({actor_user_id:10,action:'activate',reason:base.reason});
    expect(JSON.parse(event.old_values)).toMatchObject({startsAt:null,revision:0});
    expect(JSON.parse(event.new_values)).toEqual(record);
    expect(()=>db.exec("UPDATE subscription_events SET reason='changed'")).toThrow('immutable');
    expect(()=>db.exec('DELETE FROM subscription_events')).toThrow('immutable');
  });
  it.each([
    ['2024-02-29T12:34:55.999Z','scheduled'],['2024-02-29T12:34:56.000Z','active'],
    ['2025-02-28T12:34:55.999Z','active'],['2025-02-28T12:34:56.000Z','grace'],
    ['2025-03-07T12:34:55.999Z','grace'],['2025-03-07T12:34:56.000Z','expired'],
  ])('derives exclusive access boundaries at %s', (now,status)=>{
    const db=fixture();expect(subscriptions.subscriptionStatus(subscriptions.getSubscription(db,1)!,now)).toBe('pending');
    expect(subscriptions.subscriptionStatus(activate(db),now)).toBe(status);
  });
  it('treats zero grace as expiry at the exact term end',()=>{
    const db=fixture();const record=subscriptions.changeSubscription(db,{...activation,action:{...activation.action,graceDays:0}},'2024-02-29T12:34:56.000Z');
    expect(subscriptions.subscriptionStatus(record,'2025-02-28T12:34:56.000Z')).toBe('expired');
  });
  it('replays identical requests without extending a term or duplicating audit events',()=>{
    const db=fixture();const record=activate(db);
    expect(subscriptions.changeSubscription(db,activation,'2024-03-01T00:00:00.000Z')).toEqual(record);
    expect(db.prepare('SELECT COUNT(*) AS count FROM subscription_events').get()).toEqual({count:1});
    expect(()=>subscriptions.changeSubscription(db,{...activation,reason:'different'},'2024-03-01T00:00:00.000Z')).toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('rejects a stale revision without changing the subscription or its history',()=>{
    const db=fixture();activate(db);
    expect(()=>subscriptions.changeSubscription(db,{...base,requestId:'seats',action:{type:'seats',seatLimit:5}},'2024-03-01T00:00:00.000Z')).toThrow('SUBSCRIPTION_CONFLICT');
    expect(subscriptions.getSubscription(db,1)?.seatLimit).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS count FROM subscription_events').get()).toEqual({count:1});
  });
  it.each([11,12,999])('requires an active platform admin, not actor %s', actorUserId=>{
    const db=fixture();expect(()=>subscriptions.changeSubscription(db,{...activation,actorUserId},'2024-02-29T12:34:56.000Z')).toThrow('PLATFORM_ADMIN_REQUIRED');
    expect(subscriptions.getSubscription(db,1)?.revision).toBe(0);
  });
  it.each([
    {startsAt:'2024-02-30T12:34:56.000Z'}, {startsAt:'2024-02-29T15:34:56+03:00'},
    {seatLimit:0}, {seatLimit:1.5}, {graceDays:-1}, {graceDays:0.5}, {planLabel:''},
  ])('rejects invalid term inputs %j atomically', input=>{
    const db=fixture();expect(()=>subscriptions.changeSubscription(db,{...activation,action:{...activation.action,...input}},'2024-02-29T12:34:56.000Z')).toThrow('INVALID_SUBSCRIPTION_INPUT');
    expect(subscriptions.getSubscription(db,1)?.revision).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM subscription_events').get()).toEqual({count:0});
  });
  it('requires a reason and rejects duplicate activation with a new request ID',()=>{
    const db=fixture();expect(()=>subscriptions.changeSubscription(db,{...activation,reason:' '},'2024-02-29T12:34:56.000Z')).toThrow('INVALID_SUBSCRIPTION_INPUT');
    activate(db);
    expect(()=>subscriptions.changeSubscription(db,{...activation,expectedRevision:1,requestId:'activate-again'},'2024-03-01T00:00:00.000Z')).toThrow('TERM_ALREADY_ACTIVATED');
  });
  it('extends early renewal from the existing end, not confirmation day',()=>{
    const db=fixture();activate(db);
    const renewed=subscriptions.changeSubscription(db,{...base,expectedRevision:1,requestId:'renew',action:{type:'renew',graceDays:0}},'2024-12-01T00:00:00.000Z');
    expect(renewed).toMatchObject({startsAt:'2024-02-29T12:34:56.000Z',endsAt:'2026-02-28T12:34:56.000Z',graceEndsAt:'2026-02-28T12:34:56.000Z',revision:2});
    expect(subscriptions.getSubscription(db,2)?.startsAt).toBeNull();
  });
  it.each([
    [undefined,'2025-04-01T08:00:00.000Z','2026-04-01T08:00:00.000Z'],
    ['2025-05-01T08:00:00.000Z','2025-05-01T08:00:00.000Z','2026-05-01T08:00:00.000Z'],
  ])('starts late renewal from explicit agreement or confirmation', (restartAt,start,end)=>{
    const db=fixture();activate(db);
    const renewed=subscriptions.changeSubscription(db,{...base,expectedRevision:1,requestId:'renew',action:{type:'renew',graceDays:7,restartAt}},'2025-04-01T08:00:00.000Z');
    expect(renewed).toMatchObject({startsAt:start,endsAt:end});
  });
  it('requires explicit audited override to replace the end during early renewal',()=>{
    const db=fixture();activate(db);
    const request={...base,expectedRevision:1,requestId:'override',action:{type:'renew' as const,graceDays:0,restartAt:'2024-12-01T00:00:00.000Z'}};
    expect(()=>subscriptions.changeSubscription(db,request,'2024-11-01T00:00:00.000Z')).toThrow('EXPLICIT_OVERRIDE_REQUIRED');
    const record=subscriptions.changeSubscription(db,{...request,action:{...request.action,overrideExistingEnd:true}},'2024-11-01T00:00:00.000Z');
    expect(record.endsAt).toBe('2025-12-01T00:00:00.000Z');
    expect(JSON.parse((db.prepare("SELECT request_payload FROM subscription_events WHERE request_id='override'").get() as any).request_payload).action.overrideExistingEnd).toBe(true);
  });
  it('records cancellation without erasing access and suspends/reactivates independently of expiry',()=>{
    const db=fixture();activate(db);
    const cancelled=subscriptions.changeSubscription(db,{...base,expectedRevision:1,requestId:'cancel',action:{type:'cancel'}},'2024-03-01T00:00:00.000Z');
    expect(cancelled.cancelledAt).toBe('2024-03-01T00:00:00.000Z');
    expect(subscriptions.subscriptionStatus(cancelled,'2024-03-01T00:00:00.000Z')).toBe('active');
    const suspended=subscriptions.changeSubscription(db,{...base,expectedRevision:2,requestId:'suspend',reason:'Verified security incident',action:{type:'suspend'}},'2024-03-02T00:00:00.000Z');
    expect(suspended.suspensionReason).toBe('Verified security incident');
    expect(subscriptions.subscriptionStatus(suspended,'2024-03-02T00:00:00.000Z')).toBe('suspended');
    const resumed=subscriptions.changeSubscription(db,{...base,expectedRevision:3,requestId:'resume',action:{type:'reactivate'}},'2026-01-01T00:00:00.000Z');
    expect(subscriptions.subscriptionStatus(resumed,'2026-01-01T00:00:00.000Z')).toBe('expired');
    expect(resumed.endsAt).toBe('2025-02-28T12:34:56.000Z');
  });
  it('refuses seat reductions below current active usage',()=>{
    const db=fixture();activate(db);
    db.exec("INSERT INTO users VALUES(13,'user',1,0);INSERT INTO workspace_memberships VALUES(1,13,1,'editor')");
    expect(()=>subscriptions.changeSubscription(db,{...base,expectedRevision:1,requestId:'seats',action:{type:'seats',seatLimit:1}},'2024-03-01T00:00:00.000Z')).toThrow('SEAT_REDUCTION_REQUIRES_OFFBOARDING');
    expect(subscriptions.getSubscription(db,1)?.seatLimit).toBe(3);
  });
  it('creates pending records for newly inserted companies and never erases audited companies',()=>{
    const db=fixture();db.exec("INSERT INTO companies VALUES(3,'New synthetic')");
    expect(subscriptions.getSubscription(db,3)?.startsAt).toBeNull();
    db.exec('DELETE FROM companies WHERE id=3');
    expect(subscriptions.getSubscription(db,3)).toBeNull();
    activate(db);
    expect(()=>db.exec('DELETE FROM companies WHERE id=1')).toThrow('FOREIGN KEY');
    expect(subscriptions.getSubscription(db,1)?.revision).toBe(1);
  });
  it('rolls back the term change when audit persistence fails',()=>{
    const db=fixture();db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON subscription_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    expect(()=>activate(db)).toThrow('synthetic audit failure');
    expect(subscriptions.getSubscription(db,1)?.revision).toBe(0);
  });
  it.each(['id','request'] as const)('blocks SQLite replacement of immutable history by %s collision',collision=>{
    const db=fixture();activate(db);
    const before=db.prepare('SELECT * FROM subscription_events').get();
    const sql=collision==='id'
      ? "INSERT OR REPLACE INTO subscription_events SELECT id,workspace_id,actor_user_id,action,'replacement-key',request_payload,'rewritten history',old_values,new_values,created_at FROM subscription_events LIMIT 1"
      : "INSERT OR REPLACE INTO subscription_events(workspace_id,actor_user_id,action,request_id,request_payload,reason,old_values,new_values,created_at) SELECT workspace_id,actor_user_id,action,request_id,request_payload,'rewritten history',old_values,new_values,created_at FROM subscription_events LIMIT 1";
    expect(()=>db.exec(sql)).toThrow('immutable');
    expect(db.prepare('SELECT * FROM subscription_events').get()).toEqual(before);
  });
  it.each(['suspend','cancel','reactivate','renew'] as const)('allows %s without seat reduction even if staff usage exceeds the stored allowance',type=>{
    const db=fixture();activate(db);
    db.exec("INSERT INTO users VALUES(13,'user',1,0),(14,'user',1,0),(15,'user',1,0);INSERT INTO workspace_memberships VALUES(1,13,1,'editor'),(1,14,1,'editor'),(1,15,1,'editor')");
    const action=type==='renew'?{type,graceDays:7}:{type};
    const record=subscriptions.changeSubscription(db,{...base,expectedRevision:1,requestId:`overcapacity-${type}`,action},'2024-12-01T00:00:00.000Z');
    expect(record).toMatchObject({seatLimit:3,revision:2});
    if(type==='suspend')expect(subscriptions.subscriptionStatus(record,'2024-12-01T00:00:00.000Z')).toBe('suspended');
  });
});
