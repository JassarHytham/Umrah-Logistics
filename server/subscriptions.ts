import type { Database } from 'better-sqlite3';
import type { WorkspaceSubscription, SubscriptionStatus } from '../types';

export type SubscriptionAction =
  | {type:'activate';planLabel:string;startsAt:string;seatLimit:number;graceDays:number}
  | {type:'renew';graceDays:number;restartAt?:string;overrideExistingEnd?:boolean}
  | {type:'seats';seatLimit:number}
  | {type:'cancel'|'suspend'|'reactivate'};
export type SubscriptionChange = {
  workspaceId:number;actorUserId:number;expectedRevision:number;requestId:string;reason:string;action:SubscriptionAction;
};

const invalid=()=>new Error('INVALID_SUBSCRIPTION_INPUT');
const utc=(value:string)=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw invalid();
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())||date.toISOString()!==value)throw invalid();
  return date;
};
const positive=(value:number)=>{if(!Number.isSafeInteger(value)||value<1)throw invalid();return value;};
const textValue=(value:string,limit:number)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>limit)throw invalid();return value.trim();};

export function annualEnd(startsAt:string):string {
  const date=utc(startsAt);
  const month=date.getUTCMonth(),day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCFullYear(date.getUTCFullYear()+1);
  date.setUTCMonth(month+1,0);
  date.setUTCDate(Math.min(day,date.getUTCDate()));
  const result=date.toISOString();utc(result);return result;
}

export function subscriptionStatus(record:WorkspaceSubscription,now=new Date().toISOString()):SubscriptionStatus {
  const time=utc(now).getTime();
  if(record.suspendedAt)return 'suspended';
  if(!record.startsAt||!record.endsAt||!record.graceEndsAt)return 'pending';
  if(time<utc(record.startsAt).getTime())return 'scheduled';
  if(time<utc(record.endsAt).getTime())return 'active';
  return time<utc(record.graceEndsAt).getTime()?'grace':'expired';
}

// Additive storage only: no auto-activation, outbound notices or route enforcement.
export function migrateSubscriptionSchema(db:Database) {
  db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_subscriptions (
      workspace_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      plan_label TEXT NOT NULL DEFAULT 'Annual company access',
      starts_at TEXT, ends_at TEXT, grace_ends_at TEXT,
      seat_limit INTEGER CHECK(seat_limit IS NULL OR (typeof(seat_limit)='integer' AND seat_limit>0)),
      cancelled_at TEXT, suspended_at TEXT, suspension_reason TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
      CHECK((starts_at IS NULL AND ends_at IS NULL AND grace_ends_at IS NULL) OR
        (starts_at IS NOT NULL AND ends_at IS NOT NULL AND grace_ends_at IS NOT NULL AND seat_limit IS NOT NULL
          AND starts_at<ends_at AND ends_at<=grace_ends_at)),
      CHECK((suspended_at IS NULL AND suspension_reason IS NULL) OR (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS subscription_events (
      id INTEGER PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES companies(id),
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK(action IN ('activate','renew','seats','cancel','suspend','reactivate')),
      request_id TEXT NOT NULL,request_payload TEXT NOT NULL,reason TEXT NOT NULL,
      old_values TEXT NOT NULL,new_values TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(workspace_id,request_id)
    );
    CREATE TRIGGER IF NOT EXISTS subscription_events_no_update BEFORE UPDATE ON subscription_events
      BEGIN SELECT RAISE(ABORT,'Subscription events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS subscription_events_no_delete BEFORE DELETE ON subscription_events
      BEGIN SELECT RAISE(ABORT,'Subscription events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS subscription_events_no_replace BEFORE INSERT ON subscription_events
      WHEN EXISTS(SELECT 1 FROM subscription_events WHERE id=NEW.id OR (workspace_id=NEW.workspace_id AND request_id=NEW.request_id))
      BEGIN SELECT RAISE(ABORT,'Subscription events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS companies_subscription_pending AFTER INSERT ON companies
      BEGIN INSERT INTO workspace_subscriptions(workspace_id) VALUES(NEW.id); END;
    INSERT OR IGNORE INTO workspace_subscriptions(workspace_id) SELECT id FROM companies;
    INSERT OR IGNORE INTO schema_migrations(version) VALUES(3);`);
  })();
}

export function getSubscription(db:Database,workspaceId:number):WorkspaceSubscription|null {
  return (db.prepare(`SELECT workspace_id AS workspaceId,plan_label AS planLabel,starts_at AS startsAt,
    ends_at AS endsAt,grace_ends_at AS graceEndsAt,seat_limit AS seatLimit,cancelled_at AS cancelledAt,
    suspended_at AS suspendedAt,suspension_reason AS suspensionReason,updated_at AS updatedAt,revision
    FROM workspace_subscriptions WHERE workspace_id=?`).get(workspaceId) as WorkspaceSubscription|undefined)??null;
}

const graceEnd=(endsAt:string,days:number)=>{
  if(!Number.isSafeInteger(days)||days<0)throw invalid();
  const end=utc(endsAt);end.setUTCDate(end.getUTCDate()+days);
  if(!Number.isFinite(end.getTime()))throw invalid();
  const result=end.toISOString();utc(result);return result;
};

export function changeSubscription(db:Database,input:SubscriptionChange,now=new Date().toISOString()):WorkspaceSubscription {
  utc(now);positive(input.workspaceId);positive(input.actorUserId);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw invalid();
  const requestId=textValue(input.requestId,128),reason=textValue(input.reason,1000);
  return db.transaction(()=>{
    const actor=db.prepare('SELECT role,is_active,is_archived_creator FROM users WHERE id=?').get(input.actorUserId) as any;
    if(!actor||actor.role!=='admin'||!actor.is_active||actor.is_archived_creator)throw new Error('PLATFORM_ADMIN_REQUIRED');
    const old=getSubscription(db,input.workspaceId);
    if(!old)throw new Error('WORKSPACE_SUBSCRIPTION_NOT_FOUND');
    const action=input.action;
    // Stable payload includes only defined domain fields, never arbitrary client metadata.
    let normalized:SubscriptionAction;
    switch(action?.type) {
      case 'activate': normalized={type:'activate',planLabel:textValue(action.planLabel,100),startsAt:utc(action.startsAt).toISOString(),seatLimit:positive(action.seatLimit),graceDays:action.graceDays};break;
      case 'renew':
        if(action.overrideExistingEnd!==undefined&&typeof action.overrideExistingEnd!=='boolean')throw invalid();
        normalized={type:'renew',graceDays:action.graceDays,...(action.restartAt!==undefined?{restartAt:utc(action.restartAt).toISOString()}:{}),overrideExistingEnd:action.overrideExistingEnd??false};break;
      case 'seats': normalized={type:'seats',seatLimit:positive(action.seatLimit)};break;
      case 'cancel':case 'suspend':case 'reactivate':normalized={type:action.type};break;
      default:throw invalid();
    }
    const payload=JSON.stringify({actorUserId:input.actorUserId,expectedRevision:input.expectedRevision,reason,action:normalized});
    const prior=db.prepare('SELECT request_payload,new_values FROM subscription_events WHERE workspace_id=? AND request_id=?').get(input.workspaceId,requestId) as any;
    if(prior) {
      if(prior.request_payload!==payload)throw new Error('IDEMPOTENCY_CONFLICT');
      return JSON.parse(prior.new_values) as WorkspaceSubscription;
    }
    if(old.revision!==input.expectedRevision)throw new Error('SUBSCRIPTION_CONFLICT');
    const next={...old,updatedAt:now,revision:old.revision+1};
    switch(normalized.type) {
      case 'activate':
        if(old.startsAt)throw new Error('TERM_ALREADY_ACTIVATED');
        next.planLabel=normalized.planLabel;next.startsAt=normalized.startsAt;next.endsAt=annualEnd(normalized.startsAt);
        next.graceEndsAt=graceEnd(next.endsAt,normalized.graceDays);next.seatLimit=normalized.seatLimit;
        break;
      case 'renew': {
        if(!old.endsAt)throw new Error('TERM_NOT_ACTIVATED');
        const early=utc(now).getTime()<utc(old.endsAt).getTime();
        if(early&&normalized.restartAt&&!normalized.overrideExistingEnd)throw new Error('EXPLICIT_OVERRIDE_REQUIRED');
        if(normalized.overrideExistingEnd&&!normalized.restartAt)throw invalid();
        const start=normalized.restartAt??(early?old.endsAt:now);
        if(!early&&utc(start).getTime()<utc(old.endsAt).getTime()&&!normalized.overrideExistingEnd)throw new Error('EXPLICIT_OVERRIDE_REQUIRED');
        if(!early||normalized.overrideExistingEnd)next.startsAt=start;
        next.endsAt=annualEnd(start);next.graceEndsAt=graceEnd(next.endsAt,normalized.graceDays);next.cancelledAt=null;
        break;
      }
      case 'seats':next.seatLimit=normalized.seatLimit;break;
      case 'cancel':next.cancelledAt=now;break;
      case 'suspend':next.suspendedAt=now;next.suspensionReason=reason;break;
      case 'reactivate':next.suspendedAt=null;next.suspensionReason=null;break;
    }
    if(next.seatLimit!==null && (normalized.type==='activate'||(normalized.type==='seats'&&next.seatLimit!==old.seatLimit))) {
      const usage=db.prepare(`SELECT COUNT(*) AS count FROM workspace_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.workspace_id=? AND m.is_active=1 AND u.is_active=1 AND u.is_archived_creator=0 AND u.role!='admin'`).get(input.workspaceId) as {count:number};
      if(next.seatLimit<usage.count)throw new Error('SEAT_REDUCTION_REQUIRES_OFFBOARDING');
    }
    const changed=db.prepare(`UPDATE workspace_subscriptions SET plan_label=?,starts_at=?,ends_at=?,grace_ends_at=?,
      seat_limit=?,cancelled_at=?,suspended_at=?,suspension_reason=?,updated_at=?,revision=? WHERE workspace_id=? AND revision=?`)
      .run(next.planLabel,next.startsAt,next.endsAt,next.graceEndsAt,next.seatLimit,next.cancelledAt,next.suspendedAt,next.suspensionReason,next.updatedAt,next.revision,input.workspaceId,old.revision);
    if(changed.changes!==1)throw new Error('SUBSCRIPTION_CONFLICT');
    db.prepare(`INSERT INTO subscription_events(workspace_id,actor_user_id,action,request_id,request_payload,reason,old_values,new_values,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(input.workspaceId,input.actorUserId,normalized.type,requestId,payload,reason,JSON.stringify(old),JSON.stringify(next),now);
    return next;
  }).immediate();
}
