import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {dashboardSameOrigin} from "../../../../../../../server/request-origin";
import {getAuthenticatedDashboardActor} from "../../../../../../../server/auth-boundary";
import {requireWorkspaceRole} from "../../../../../../../server/workspace-access";
import {requireDashboardEntitlement} from "../../../../../../../features/subscriptions/entitlements";
import {dashboardDb} from "../../../../../../../server/db";
import {readWorkspaceObject} from "../../../../../../../server/workspace-storage";

type Ctx={params:Promise<{workspaceId:string;datasetId:string}>};
const headers={"Cache-Control":"no-store"};
const respond=(error:string,status:number)=>NextResponse.json({error},{status,headers});

export async function POST(request:Request,context:Ctx){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.write');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return respond("CROSS_ORIGIN_REQUEST",403);
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return respond("UNAUTHORIZED",401);
 const {workspaceId,datasetId}=await context.params;
 if(!await requireWorkspaceRole(actor,workspaceId,"EDITOR"))return respond("FORBIDDEN",403);
 if(!await requireDashboardEntitlement(actor,workspaceId))return respond("SUBSCRIPTION_REQUIRED",402);
 let versionId:string;
 try{
  const raw=await request.text();
  if(raw.length>1024)return respond("BODY_TOO_LARGE",413);
  const payload:unknown=JSON.parse(raw);
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||Object.keys(payload).join(",")!=="versionId")return respond("INVALID_ROLLBACK",400);
  const value=(payload as {versionId:unknown}).versionId;
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value))return respond("INVALID_ROLLBACK",400);
  versionId=value;
 }catch{return respond("INVALID_ROLLBACK",400);}
 try{
  const candidate=await dashboardDb.dashboardDatasetVersion.findFirst({
   where:{id:versionId,datasetId,dataset:{workspaceId},status:"READY",profiledAt:{not:null}},
   select:{storageKey:true,checksum:true,fileSize:true},
  });
  if(!candidate)return respond("VERSION_UNAVAILABLE",404);
  let verified=false;
  try{
   const bytes=await readWorkspaceObject(actor,workspaceId,candidate.storageKey);
   verified=BigInt(bytes.length)===candidate.fileSize&&createHash("sha256").update(bytes).digest("hex")===candidate.checksum;
  }catch{verified=false;}
  if(!verified)return respond("VERSION_INTEGRITY_FAILURE",409);
  const result=await dashboardDb.$transaction(async tx=>{
   const dataset=await tx.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:{not:"ARCHIVED"}},select:{id:true,activeVersionId:true}});
   if(!dataset)return {ok:false as const,error:"DATASET_UNAVAILABLE" as const};
   const version=await tx.dashboardDatasetVersion.findFirst({where:{id:versionId,datasetId,status:"READY",profiledAt:{not:null}},select:{id:true,version:true}});
   if(!version)return {ok:false as const,error:"VERSION_UNAVAILABLE" as const};
   // Cancel queued/running jobs on other versions so they cannot silently override the rollback.
   const unfinished=await tx.dashboardDatasetVersion.findMany({where:{datasetId,status:"PENDING"},select:{id:true}});
   for(const pending of unfinished){
    await tx.dashboardJob.updateMany({where:{workspaceId,kind:"DATASET_PROFILE",payload:{path:["versionId"],equals:pending.id},status:"QUEUED"},data:{status:"CANCELLED",cancelRequestedAt:new Date(),finishedAt:new Date()}});
    await tx.dashboardJob.updateMany({where:{workspaceId,kind:"DATASET_PROFILE",payload:{path:["versionId"],equals:pending.id},status:"RUNNING"},data:{cancelRequestedAt:new Date()}});
   }
   await tx.dashboardDatasetVersion.updateMany({where:{datasetId,status:"PENDING"},data:{status:"CANCELLED"}});
   await tx.dashboardDataset.update({where:{id:datasetId},data:{activeVersionId:versionId,status:"READY"}});
   return {ok:true as const,activeVersionId:versionId,version:version.version,previousVersionId:dataset.activeVersionId};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  if(!result.ok)return respond(result.error,result.error==="VERSION_UNAVAILABLE"?404:404);
  return NextResponse.json(result,{headers});
 }catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2034")return respond("CONFLICT",409);
  return respond("ROLLBACK_FAILED",503);
 }
}
