import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {storageOwner,storageHttpError,storageHeaders} from '../../../../../../../features/storage/http';
import {archiveDatasetForRetention} from '../../../../../../../features/storage/lifecycle';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;datasetId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
try{const {workspaceId,datasetId}=await context.params;const actor=await storageOwner(request,workspaceId,true);return NextResponse.json(await archiveDatasetForRetention(actor,workspaceId,datasetId),{headers:storageHeaders});}catch(error){return storageHttpError(error);}}
