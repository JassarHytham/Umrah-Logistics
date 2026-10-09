export function createLatestDataLoader() {
  let generation=0;
  return {
    invalidate:()=>{generation++;},
    async run<T>(fetchData:()=>Promise<T>,apply:(data:T)=>void,onError:(error:unknown)=>void=()=>{},onSettled:()=>void=()=>{}) {
      const request=++generation;
      try{const data=await fetchData();if(request===generation)apply(data);}
      catch(error){if(request===generation)onError(error);}
      finally{if(request===generation)onSettled();}
    },
  };
}

export function createLiveRefreshListener(invalidate:()=>void,refresh:()=>void|Promise<void>) {
  const reconcile=()=>{invalidate();return refresh();};
  return {onOpen:reconcile,onChange:reconcile};
}
