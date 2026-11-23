import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {customSourceHttpError,customSourceHeaders} from '../../../../../../../features/custom-sources/http';
import {NextResponse} from 'next/server';
type Context={params:Promise<{workspaceId:string;connectorId:string}>};
import {acceptSourceWebhook} from '../../../../../../../features/custom-sources/webhook';
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.manage');if(permissionDenied)return permissionDenied;
 try{const {workspaceId,connectorId}=await context.params;return NextResponse.json(await acceptSourceWebhook(workspaceId,connectorId,request),{status:202,headers:customSourceHeaders});}catch(e){return customSourceHttpError(e);}
}
