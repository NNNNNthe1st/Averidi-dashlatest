export type QueryCacheSettings={key:string;ttlSeconds:number;maxEntries:number};
export function queryCacheSettings(env:Partial<NodeJS.ProcessEnv>=process.env):QueryCacheSettings|null{
 const flag=env.DASHBOARD_QUERY_CACHE_ENABLED;
 if(!flag||flag==='false')return null;
 if(flag!=='true'||env.DASHBOARD_WORKER_ENABLED!=='true'||! /^[a-fA-F0-9]{64}$/.test(env.DASHBOARD_QUERY_CACHE_KEY??''))throw Error('QUERY_CACHE_CONFIGURATION_INVALID');
 const integer=(key:keyof NodeJS.ProcessEnv,fallback:number,min:number,max:number)=>{const raw=env[key]??String(fallback);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw Error('QUERY_CACHE_CONFIGURATION_INVALID');return Number(raw);};
 return {key:env.DASHBOARD_QUERY_CACHE_KEY!,ttlSeconds:integer('DASHBOARD_QUERY_CACHE_TTL_SECONDS',300,30,3600),maxEntries:integer('DASHBOARD_QUERY_CACHE_MAX_ENTRIES',32,1,64)};
}
