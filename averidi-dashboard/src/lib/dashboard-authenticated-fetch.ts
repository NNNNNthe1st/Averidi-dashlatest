"use client";
// Dashboard-only transport. Concurrent 401 responses share one same-origin refresh,
// including across tabs. Only safe reads and the read-only dataset preview may be replayed.
let renewal:Promise<boolean>|null=null;

async function renewSessionOnce():Promise<boolean>{
 try{
  const response=await fetch("/dashboard/app/api/auth/refresh",{
   method:"POST",credentials:"same-origin",cache:"no-store",
   headers:{"Content-Type":"application/json"},body:"{}",
  });
  return response.ok;
 }catch{return false;}
}

async function renewSessionAfterLock():Promise<boolean>{
 // A different tab may have completed refresh while this tab waited for the lock.
 // Check the current cookie-backed identity before consuming another single-use token.
 try{
  const current=await fetch("/dashboard/app/api/auth/me",{
   method:"GET",credentials:"same-origin",cache:"no-store",
  });
  if(current.ok)return true;
  if(current.status!==401)return false;
 }catch{return false;}
 return renewSessionOnce();
}

export async function refreshDashboardSession():Promise<boolean>{
 if(!renewal){
  renewal=(async()=>{
   try{
    // Web Locks coordinates refreshes across browser tabs/windows. Recheck the
    // cookie-backed session after acquiring the lock to avoid rotating it twice.
    if(typeof navigator!=="undefined"&&navigator.locks){
     return await navigator.locks.request("averidi-dashboard-session-refresh",renewSessionAfterLock);
    }
    return await renewSessionOnce();
   }catch{return false;}
  })();
  void renewal.then(()=>{renewal=null;},()=>{renewal=null;});
 }
 return renewal;
}

export async function dashboardAuthenticatedFetch(input:string,init:RequestInit={}):Promise<Response>{
 const method=(init.method??"GET").toUpperCase();
 const options:RequestInit={...init,credentials:"same-origin",cache:init.cache??"no-store"};
 let response=await fetch(input,options);
 if(response.status!==401||init.signal?.aborted)return response;
 const refreshed=await refreshDashboardSession();
 if(!refreshed||init.signal?.aborted)return response;
 // Dataset preview is a read-only operation despite using POST for multipart input.
 // Its handler validates and profiles the file without persisting or changing state.
 let isDatasetPreview=false;
 try{
  const path=new URL(input,"https://dashboard.invalid").pathname;
  const parts=path.split("/");
  isDatasetPreview=parts.length===8&&parts[1]==="dashboard"&&parts[2]==="app"&&parts[3]==="api"&&parts[4]==="workspaces"&&Boolean(parts[5])&&parts[6]==="datasets"&&parts[7]==="preview";
 }catch{}
 const retryable=method==="GET"||method==="HEAD"||(method==="POST"&&isDatasetPreview);
 // Never replay state-changing requests: they may already have reached the server.
 if(!retryable)return response;
 return fetch(input,options);
}
