import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {connectorActor,connectorHttpError,connectorHeaders} from '../../../../../../features/connectors/http-api';
import {disconnectConnector} from '../../../../../../features/connectors/service';
export async function DELETE(request:Request,context:{params:Promise<{workspaceId:string;connectorId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.manage');if(permissionDenied)return permissionDenied;
try{const actor=await connectorActor(request,true);const {workspaceId,connectorId}=await context.params;return NextResponse.json(await disconnectConnector(actor,workspaceId,connectorId),{headers:connectorHeaders});}catch(error){return connectorHttpError(error);}}
