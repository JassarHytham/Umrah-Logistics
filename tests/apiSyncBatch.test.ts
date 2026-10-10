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
});
