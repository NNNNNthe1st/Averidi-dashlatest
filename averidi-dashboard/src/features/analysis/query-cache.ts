import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {dashboardDb as db} from '../../server/db';
import {setAuditActor} from '../audit/context';
import {storageMutationGuard} from '../storage/guard';
import {erasureAdmissionCode} from '../account-erasure/errors';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import type {QueryCacheSettings} from './cache-contracts';
export const QUERY_CACHE_VERSION=1;
export const QUERY_CACHE_MAX_BYTES=262144;
type Binding={id:string;workspaceId:string;viewId:string;scopeHash:string};
type Entry=Binding&{payload:string;signature:string;createdAt:Date;expiresAt:Date};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function queryCacheBinding(workspaceId:string,viewId:string,scope:unknown,query:unknown):Binding{
 const scopeHash=hash([QUERY_CACHE_VERSION,workspaceId,viewId,scope]);return {id:hash([scopeHash,query]),workspaceId,viewId,scopeHash};
}
function signature(row:Omit<Entry,'signature'>,settings:QueryCacheSettings){return createHmac('sha256',Buffer.from(settings.key,'hex')).update(JSON.stringify([QUERY_CACHE_VERSION,row.id,row.workspaceId,row.viewId,row.scopeHash,row.createdAt.toISOString(),row.expiresAt.toISOString(),row.payload])).digest('hex');}
export async function readQueryCache(binding:Binding,settings:QueryCacheSettings):Promise<unknown|null>{
 const rows=await db.$queryRaw<Entry[]>`SELECT c.* FROM "DashboardQueryCache" c WHERE c.id=${binding.id} AND c."workspaceId"=${binding.workspaceId} AND c."viewId"=${binding.viewId} AND c."scopeHash"=${binding.scopeHash}
 AND c."createdAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
 AND c."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
 AND c."createdAt">((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-${settings.ttlSeconds}::double precision*INTERVAL '1 second')
 AND NOT EXISTS(SELECT 1 FROM "DashboardStorageMaintenance" WHERE id='storage' AND "expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`;
 const row=rows[0];if(!row||Buffer.byteLength(row.payload)>QUERY_CACHE_MAX_BYTES||! /^[a-f0-9]{64}$/.test(row.signature))return null;
 const expected=signature(row,settings);if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(row.signature,'hex')))return null;
 try{return JSON.parse(row.payload);}catch{return null;}
}
/** Cache writes are best effort. A full cache never evicts a fresh entry just to admit a novel query. */
export async function writeQueryCache(actor:VerifiedDashboardActor,binding:Binding,value:unknown,settings:QueryCacheSettings){
 const payload=JSON.stringify(value);if(!payload||Buffer.byteLength(payload)>QUERY_CACHE_MAX_BYTES)return false;
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL statement_timeout='1500ms'`;
  await setAuditActor(tx,actor);await storageMutationGuard(tx);
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'dashboard-query-cache:'+binding.workspaceId},0))`;
  const [clock]=await tx.$queryRaw<{now:Date}[]>`SELECT date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC') AS now`;
  const now=clock.now,oldest=new Date(now.getTime()-settings.ttlSeconds*1000);
  await tx.dashboardQueryCache.deleteMany({where:{workspaceId:binding.workspaceId,OR:[{expiresAt:{lte:now}},{createdAt:{lte:oldest}},{viewId:binding.viewId,scopeHash:{not:binding.scopeHash}}]}});
  const exists=await tx.dashboardQueryCache.count({where:{id:binding.id,workspaceId:binding.workspaceId}});
  if(!exists&&await tx.dashboardQueryCache.count({where:{workspaceId:binding.workspaceId}})>=settings.maxEntries)return false;
  const entry={...binding,payload,createdAt:now,expiresAt:new Date(now.getTime()+settings.ttlSeconds*1000)};
  await tx.dashboardQueryCache.upsert({where:{id:binding.id},create:{...entry,signature:signature(entry,settings)},update:{...entry,signature:signature(entry,settings)}});return true;
 },{maxWait:250,timeout:2500});
}
/** Bounded independent worker maintenance; active erasure/restore scopes remain authoritative. */
export async function pruneExpiredQueryCache(settings:QueryCacheSettings){
 try{return await db.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL statement_timeout='3s'`;
  await setAuditActor(tx,{issuer:'dashboard-worker',subject:'query-cache-cleanup'},'WORKER');await storageMutationGuard(tx);
  return tx.$executeRaw`WITH candidates AS (
   SELECT c.id FROM "DashboardQueryCache" c JOIN "DashboardWorkspace" w ON w.id=c."workspaceId" WHERE w."erasureRequestId" IS NULL
   AND (c."expiresAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') OR c."createdAt"<=((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-${settings.ttlSeconds}::double precision*INTERVAL '1 second'))
   ORDER BY c."expiresAt",c.id LIMIT 500 FOR UPDATE OF c SKIP LOCKED
  ) DELETE FROM "DashboardQueryCache" WHERE id IN(SELECT id FROM candidates)`;
 },{maxWait:500,timeout:5000});}catch(error){
  if(error instanceof Error&&error.message==='STORAGE_MAINTENANCE'||['ACCOUNT_ERASURE_BUSY','WORKSPACE_ERASING'].includes(erasureAdmissionCode(error)??''))return 0;throw error;
 }
}
