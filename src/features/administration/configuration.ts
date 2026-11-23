import {setAuditActor} from '../audit/context';
import {configurationChangeSchema as input} from '../../contracts/administration';
import {dashboardDb as db} from '../../server/db';
import type {AdminActor} from '../billing/contracts';
import type {Prisma} from '@prisma/client';
import {configurationCatalog,configurationKeys,type AdmissionSetting} from '../../contracts/configuration';
export {configurationKeys};
export async function dashboardConfiguration(){
 const settings=await db.dashboardConfiguration.findMany({where:{key:{in:configurationKeys}},orderBy:{key:'asc'},select:{key:true,value:true,updatedAt:true}});
 return {settings,catalog:configurationKeys.map(key=>{const definition=configurationCatalog[key],record=settings.find(row=>row.key===key),value=definition.schema.parse(record?record.value:definition.default);return {key,type:typeof definition.default,default:definition.default,value,updatedAt:record?.updatedAt.toISOString()??null,description:definition.description};})};
}
export async function assertDashboardAdmission(tx:Prisma.TransactionClient,key:AdmissionSetting){
 await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(hashtextextended(${'dashboard-config:'+key},0))`;
 const row=await tx.dashboardConfiguration.findUnique({where:{key},select:{value:true,updatedAt:true}});
 if(row&&row.value!==true)throw Error('CONFIGURATION_ACTION_DISABLED');
}

/** Secrets, integration flags, release controls and arbitrary executable settings are never editable here. */
export async function updateDashboardConfiguration(body:unknown,actor:AdminActor){
 const parsed=input.safeParse(body);if(!parsed.success)throw Error('INVALID_BILLING_INPUT');const v=parsed.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dashboard-config:${v.key}`},0))`;
  const previous=await tx.dashboardConfiguration.findUnique({where:{key:v.key},select:{value:true,updatedAt:true}});
  if(v.expectedUpdatedAt!==undefined&&(previous?.updatedAt.toISOString()??null)!==v.expectedUpdatedAt)throw Error('CONFIGURATION_CONFLICT');
  const updatedAt=new Date(Math.max(Date.now(),(previous?.updatedAt.getTime()??0)+1));
  const record=await tx.dashboardConfiguration.upsert({where:{key:v.key},create:{key:v.key,value:v.value,updatedAt},update:{value:v.value,updatedAt},select:{key:true,value:true,updatedAt:true}});
  await tx.dashboardAdminAudit.create({data:{actorIssuer:actor.issuer,actorSubject:actor.subject,action:'ADMIN_CONFIGURATION',details:JSON.stringify({key:v.key,previous:previous?.value??null,next:v.value,previousRevision:previous?.updatedAt.toISOString()??null,revision:record.updatedAt.toISOString(),reason:v.reason})}});return record;
 });
}
