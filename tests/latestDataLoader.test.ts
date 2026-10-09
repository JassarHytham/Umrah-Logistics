import { describe, expect, it } from 'vitest';
import * as loaders from '../utils/latestDataLoader';

const deferred=<T>()=>{let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
describe('latest authorized data reconciliation',()=>{
  it('cannot replace newer restricted data with an older company-wide response',async()=>{
    expect(typeof (loaders as any).createLatestDataLoader).toBe('function');
    const loader=(loaders as any).createLatestDataLoader();
    const old=deferred<string[]>(),fresh=deferred<string[]>();let rows:string[]=[];
    const first=loader.run(()=>old.promise,(value:string[])=>{rows=value;});
    const second=loader.run(()=>fresh.promise,(value:string[])=>{rows=value;});
    fresh.resolve(['own']);await second;old.resolve(['own','coworker']);await first;
    expect(rows).toEqual(['own']);
  });
  it('invalidates an in-flight load as soon as a policy refresh is scheduled, not only after debounce',async()=>{
    const loader=(loaders as any).createLatestDataLoader(),old=deferred<string[]>();let rows:string[]=[];
    const request=loader.run(()=>old.promise,(value:string[])=>{rows=value;});
    loader.invalidate();old.resolve(['coworker']);await request;
    expect(rows).toEqual([]);
  });
  it('ignores stale failure and settlement callbacks after a newer load succeeds',async()=>{
    const loader=(loaders as any).createLatestDataLoader(),old=deferred<string[]>();const events:string[]=[];
    const first=loader.run(()=>old.promise,()=>events.push('old'),()=>events.push('old-error'),()=>events.push('old-finished'));
    await loader.run(async()=>['own'],()=>events.push('fresh'),()=>events.push('fresh-error'),()=>events.push('fresh-finished'));
    old.reject(new Error('stale failure'));await first;
    expect(events).toEqual(['fresh','fresh-finished']);
  });
  it('reconciles missed policy changes on each live connection without recreating a connection for data changes',async()=>{
    expect(typeof (loaders as any).createLiveRefreshListener).toBe('function');
    let rows=['own','coworker'],policy=true,loads=0,invalidations=0;
    const listener=(loaders as any).createLiveRefreshListener(()=>{invalidations++;},async()=>{loads++;rows=policy?['own','coworker']:['own'];});
    await listener.onOpen();policy=false;await listener.onOpen();
    expect(rows).toEqual(['own']);expect(loads).toBe(2);expect(invalidations).toBe(2);
  });
});
