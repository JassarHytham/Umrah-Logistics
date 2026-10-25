import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';

afterEach(() => vi.unstubAllGlobals());

const ok = () => new Response(JSON.stringify({success:true}), {
  status:200, headers:{'content-type':'application/json'},
});

describe('trip sync batching',()=>{
  it('sends more than 5000 rows as ordered, bounded requests in the same workspace',async()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const fetchMock=vi.fn().mockImplementation(async()=>ok());
    vi.stubGlobal('fetch',fetchMock);
    const rows=Array.from({length:5001},(_,index)=>({id:`trip-${index}`}));

    await api.data.syncRows(rows,2);

    const bodies=fetchMock.mock.calls.map(([,options])=>JSON.parse(options.body));
    expect(bodies).toHaveLength(6);
    expect(bodies.every(body=>body.workspaceId===2&&body.rows.length<=1000)).toBe(true);
    expect(bodies.flatMap(body=>body.rows.map((row:{id:string})=>row.id))).toEqual(rows.map(row=>row.id));
  });

  it('stops after a failed batch and exposes the server error',async()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response(JSON.stringify({error:'Trip conflict'}),{
        status:409,headers:{'content-type':'application/json'},
      }));
    vi.stubGlobal('fetch',fetchMock);
    const rows=Array.from({length:2001},(_,index)=>({id:`trip-${index}`}));

    await expect(api.data.syncRows(rows)).rejects.toMatchObject({status:409,message:'Trip conflict',partialSync:true});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains an empty sync request for an empty table',async()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const fetchMock=vi.fn().mockImplementation(async()=>ok());
    vi.stubGlobal('fetch',fetchMock);
    await api.data.syncRows([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({rows:[]});
  });

  it('collects skipped client ids across successful batches',async()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({success:true,skippedDuplicates:[{clientId:'trip-0',existingId:'saved-0'}]}),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({success:true,skippedDuplicates:[{clientId:'trip-1000',existingId:'saved-1000'}]}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const result=await api.data.syncRows(Array.from({length:1001},(_,index)=>({id:`trip-${index}`})));
    expect(result.skippedDuplicates).toEqual([
      {clientId:'trip-0',existingId:'saved-0'},
      {clientId:'trip-1000',existingId:'saved-1000'},
    ]);
  });

  it('retries the same skipped client id after a later offline batch failure',async()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    const rows=Array.from({length:1001},(_,index)=>({id:`retry-trip-${index}`}));
    const firstFetch=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({success:true,skippedDuplicates:[{clientId:rows[0].id,existingId:'saved-trip'}]}),{status:200,headers:{'content-type':'application/json'}}))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch',firstFetch);
    await expect(api.data.syncRows(rows)).rejects.toMatchObject({partialSync:true});

    const retryFetch=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({success:true,skippedDuplicates:[{clientId:rows[0].id,existingId:'saved-trip'}]}),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch',retryFetch);
    const retry=await api.data.syncRows(rows);
    expect(retry.skippedDuplicates).toEqual([{clientId:rows[0].id,existingId:'saved-trip'}]);
    expect(JSON.parse(retryFetch.mock.calls[0][1].body).rows[0].id).toBe(rows[0].id);
  });
});
