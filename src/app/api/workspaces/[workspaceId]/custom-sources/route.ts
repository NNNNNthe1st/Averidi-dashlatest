import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {customSourceHttpError,customSourceHeaders} from '../../../../../features/custom-sources/http';
import {NextResponse} from 'next/server';
type Context={params:Promise<{workspaceId:string}>};
import {connectorActor,connectorJson} from '../../../../../features/connectors/http-api';
import {readCustomSources,mutateCustomSource} from '../../../../../features/custom-sources/service';
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await readCustomSources(await connectorActor(request),(await context.params).workspaceId),{headers:customSourceHeaders});}catch(e){return customSourceHttpError(e);}
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await mutateCustomSource(await connectorActor(request,true),(await context.params).workspaceId,await connectorJson(request)),{headers:customSourceHeaders});}catch(e){return customSourceHttpError(e);}
}
