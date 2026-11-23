import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../../../server/db';
import {storageOwner,storageJson,storageHttpError,storageHeaders} from '../../../../../../features/storage/http';
import {saveStoragePolicy} from '../../../../../../features/storage/lifecycle';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
try{const {workspaceId}=await context.params;await storageOwner(request,workspaceId);return NextResponse.json({policy:await dashboardDb.dashboardStoragePolicy.findUnique({where:{workspaceId}})},{headers:storageHeaders});}catch(error){return storageHttpError(error);}}
export async function PUT(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
try{const {workspaceId}=await context.params;const actor=await storageOwner(request,workspaceId,true);return NextResponse.json({policy:await saveStoragePolicy(actor,workspaceId,await storageJson(request))},{headers:storageHeaders});}catch(error){return storageHttpError(error);}}
