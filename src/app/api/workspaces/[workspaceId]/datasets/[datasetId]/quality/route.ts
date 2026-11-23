import {readQuality,reviewQuality} from '../../../../../../../features/data-model/quality';
import {enqueueActorDashboardJob} from '../../../../../../../worker/queue';
import {z} from 'zod';
import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {dataActor,dataError,headers} from '../../../../../../../features/data-model/http';
import {analysisJson} from '../../../../../../../features/analysis/http';
import {NextResponse} from 'next/server';
type Context={params:Promise<{workspaceId:string;datasetId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await readQuality(await dataActor(request),(await context.params).workspaceId,(await context.params).datasetId),{headers});}catch(e){return dataError(e);}
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.write');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await qualityCommand(request,context),{headers});}catch(e){return dataError(e);}
}
async function qualityCommand(request:Request,context:Context){const actor=await dataActor(request,true),{workspaceId,datasetId}=await context.params,body=await analysisJson(request);if(body&&typeof body==='object'&&'action' in body&&body.action==='VALIDATE'){const parsed=z.object({action:z.literal('VALIDATE'),versionId:z.string().min(1).max(128),requestId:z.uuid()}).strict().safeParse(body);if(!parsed.success)throw Error('INVALID_QUALITY_REVIEW');return enqueueActorDashboardJob(actor,workspaceId,'DATASET_VALIDATE',{datasetId,versionId:parsed.data.versionId},'validation_'+parsed.data.requestId);}return reviewQuality(actor,workspaceId,datasetId,body);}
