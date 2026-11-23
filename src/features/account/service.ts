import {auditedWrite} from '../audit/service';
import {z} from 'zod';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
const displayName=z.string().trim().min(1).max(120).nullable();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('PROFILE'),displayName,expectedDisplayName:displayName}).strict(),
 z.object({action:z.literal('REVOKE_SESSION'),id:z.string().min(1).max(128)}).strict(),
]);
export async function readAccount(actor:Actor,currentSessionId?:string){
 const [profile,sessions]=await Promise.all([db.dashboardUser.findUniqueOrThrow({where:{id:actor.userId},select:{displayName:true}}),db.dashboardSession.findMany({where:{userId:actor.userId,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true,createdAt:true,expiresAt:true},orderBy:{createdAt:'desc'},take:100})]);
 return {erasureAvailable:process.env.DASHBOARD_ACCOUNT_ERASURE_ENABLED==='true',profile,sessions:sessions.map(s=>({...s,current:s.id===currentSessionId}))};
}
export async function updateAccount(actor:Actor,input:unknown){
 const p=schema.safeParse(input);if(!p.success)throw Error('INVALID_QUERY');const c=p.data;
 if(c.action==='PROFILE'){
  const changed=await auditedWrite(actor,tx=>tx.dashboardUser.updateMany({where:{id:actor.userId,displayName:c.expectedDisplayName},data:{displayName:c.displayName}}));if(!changed.count)throw Error('VERSION_CONFLICT');return {ok:true};
 }
 const changed=await auditedWrite(actor,tx=>tx.dashboardSession.updateMany({where:{id:c.id,userId:actor.userId,revokedAt:null,expiresAt:{gt:new Date()}},data:{revokedAt:new Date()}}));if(!changed.count)throw Error('NOT_FOUND');return {ok:true};
}
