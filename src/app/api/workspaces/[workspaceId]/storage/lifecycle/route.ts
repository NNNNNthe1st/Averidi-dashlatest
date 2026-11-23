import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {z} from 'zod';
import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../../../server/db';
import {storageOwner,storageJson,storageHttpError,storageHeaders} from '../../../../../../features/storage/http';
import {enqueueDashboardJob} from '../../../../../../worker/queue';
import {storageMutationGuard} from '../../../../../../features/storage/guard';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
try{const {workspaceId}=await context.params;await storageOwner(request,workspaceId);const deletions=await dashboardDb.dashboardStorageDeletion.findMany({where:{workspaceId},orderBy:{observedAt:'desc'},take:100});return NextResponse.json({deletions:deletions.map(d=>({...d,fileSize:String(d.fileSize)}))},{headers:storageHeaders});}catch(error){return storageHttpError(error);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
try{const {workspaceId}=await context.params;await storageOwner(request,workspaceId,true);const parsed=z.object({action:z.enum(['PLAN','APPLY'])}).strict().safeParse(await storageJson(request));if(!parsed.success)throw Error('INVALID_STORAGE_POLICY');const job=await enqueueDashboardJob(workspaceId,'DATA_CLEANUP',{lifecycle:parsed.data.action,temporaryKeys:[],expiredReports:false},request.headers.get('Idempotency-Key')??'');return NextResponse.json({jobId:job.id,status:job.status},{status:202,headers:storageHeaders});}catch(error){return storageHttpError(error);}}
export async function DELETE(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
try{const {workspaceId}=await context.params;await storageOwner(request,workspaceId,true);const parsed=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)}).strict().safeParse(await storageJson(request));if(!parsed.success)throw Error('INVALID_STORAGE_POLICY');const changed=await dashboardDb.$transaction(async tx=>{await storageMutationGuard(tx);return tx.dashboardStorageDeletion.updateMany({where:{id:parsed.data.id,workspaceId,status:'PLANNED'},data:{status:'CANCELLED'}});});return NextResponse.json({cancelled:changed.count===1},{headers:storageHeaders});}catch(error){return storageHttpError(error);}}
