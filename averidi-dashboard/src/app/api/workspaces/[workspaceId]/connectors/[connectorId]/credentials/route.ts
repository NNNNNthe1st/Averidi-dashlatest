import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {connectorActor,connectorJson,connectorHttpError,connectorHeaders} from '../../../../../../../features/connectors/http-api';
import {setConnectorApiCredential} from '../../../../../../../features/connectors/service';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;connectorId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.manage');if(permissionDenied)return permissionDenied;
try{const actor=await connectorActor(request,true);const {workspaceId,connectorId}=await context.params;return NextResponse.json(await setConnectorApiCredential(actor,workspaceId,connectorId,await connectorJson(request)),{headers:connectorHeaders});}catch(error){return connectorHttpError(error);}}
