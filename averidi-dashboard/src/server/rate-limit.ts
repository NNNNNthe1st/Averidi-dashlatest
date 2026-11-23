import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import type {PrismaClient} from '@prisma/client';

type Settings={api:number;auth:number;ipHeader:string|null};
export function dashboardRateLimitSettings(env:Record<string,string|undefined>=process.env):Settings {
 const integer=(key:string,fallback:number)=>{const raw=env[key];if(raw===undefined)return fallback;if(!/^[1-9][0-9]{0,5}$/.test(raw)||Number(raw)>100000)throw Error('RATE_LIMIT_CONFIGURATION_INVALID');return Number(raw);};
 const header=env.DASHBOARD_RATE_LIMIT_IP_HEADER;
 if(header!==undefined&&(!/^x-[a-z0-9-]{1,60}$/.test(header)||env.DASHBOARD_RATE_LIMIT_TRUST_PROXY!=='true'))throw Error('RATE_LIMIT_CONFIGURATION_INVALID');
 if(env.DASHBOARD_RATE_LIMIT_TRUST_PROXY!==undefined&&!['true','false'].includes(env.DASHBOARD_RATE_LIMIT_TRUST_PROXY))throw Error('RATE_LIMIT_CONFIGURATION_INVALID');
 return {api:integer('DASHBOARD_RATE_LIMIT_API_PER_MINUTE',600),auth:integer('DASHBOARD_RATE_LIMIT_AUTH_PER_MINUTE',30),ipHeader:header??null};
}
/** No forwarded header is trusted unless an operator explicitly configures its overwriting proxy. */
export function dashboardRateLimitNetwork(request:Request,settings:Settings):string {
 const raw=settings.ipHeader?request.headers.get(settings.ipHeader)?.trim():null;
 if(!raw||raw.length>64||raw.includes('%')||!isIP(raw))return 'unattributed';
 if(isIP(raw)===4)return raw;
 // URL canonicalization converts IPv4-mapped forms and compresses equivalent IPv6 spellings.
 const canonical=new URL('http://['+raw+']/').hostname.slice(1,-1).toLowerCase();
 const [left,right]=canonical.split('::'),before=left?left.split(':'):[],after=right?right.split(':'):[];
 const parts=right===undefined?before:[...before,...Array(8-before.length-after.length).fill('0'),...after];
 if(parts.slice(0,5).every(x=>parseInt(x,16)===0)&&parseInt(parts[5],16)===65535){const hi=parseInt(parts[6],16),lo=parseInt(parts[7],16);return [hi>>8,hi&255,lo>>8,lo&255].join('.');}
 // One IPv6 /64 shares a budget; privacy-address rotation cannot bypass it.
 return parts.slice(0,4).map(p=>parseInt(p,16).toString(16)).join(':')+'::/64';
}
export function dashboardRateLimitPolicy(pathname:string):'API'|'AUTH'|null {
 if(!pathname.startsWith('/api/'))return null;
 if(['/api/health','/api/health/ready','/api/auth/logout','/api/auth/logout-all'].includes(pathname))return null;
 return pathname.startsWith('/api/auth/')?'AUTH':'API';
}
export type RateLimitResult={allowed:boolean;limit:number;remaining:number;retryAfter:number;reset:number};
/** One atomic PostgreSQL upsert shared by every web process; denied counts saturate. */
export async function consumeDashboardRateLimit(key:string,limit:number,db:Pick<PrismaClient,'$queryRaw'>):Promise<RateLimitResult> {
 const rows=await db.$queryRaw<{count:number;reset:Date;now:Date}[]>`
 WITH bucket_window AS (SELECT date_trunc('minute',clock_timestamp() AT TIME ZONE 'UTC') AS start)
 INSERT INTO "DashboardRequestBucket" ("key","windowStart","count","expiresAt")
 SELECT ${key},start,1,start+interval '2 minutes' FROM bucket_window
 ON CONFLICT ("key") DO UPDATE SET
 "count"=CASE WHEN "DashboardRequestBucket"."windowStart">=EXCLUDED."windowStart" THEN LEAST("DashboardRequestBucket"."count"+1,${limit+1}) ELSE 1 END,
 "windowStart"=GREATEST("DashboardRequestBucket"."windowStart",EXCLUDED."windowStart"),"expiresAt"=GREATEST("DashboardRequestBucket"."expiresAt",EXCLUDED."expiresAt")
 RETURNING "count","windowStart"+interval '1 minute' AS reset,clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 const row=rows[0];if(!row)throw Error('RATE_LIMIT_STORE_UNAVAILABLE');
 return {allowed:row.count<=limit,limit,remaining:Math.max(0,limit-row.count),retryAfter:Math.max(1,Math.ceil((row.reset.getTime()-row.now.getTime())/1000)),reset:Math.ceil(row.reset.getTime()/1000)};
}
export async function checkDashboardRequestRate(request:Request,pathname:string,db?:Pick<PrismaClient,'$queryRaw'>):Promise<RateLimitResult|null> {
 const policy=dashboardRateLimitPolicy(pathname);if(!policy)return null;
 const settings=dashboardRateLimitSettings(),network=dashboardRateLimitNetwork(request,settings);
 const key=createHash('sha256').update('dashboard-rate-v1|'+policy+'|'+network).digest('hex');
 const store=db??(await import('./db')).dashboardDb;
 return consumeDashboardRateLimit(key,policy==='AUTH'?settings.auth:settings.api,store);
}
