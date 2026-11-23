import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {connectorActor,connectorJson,connectorHttpError,connectorHeaders} from '../../../../../features/connectors/http-api';
import {createConnector,listConnectors} from '../../../../../features/connectors/service';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.read');if(permissionDenied)return permissionDenied;
try{const actor=await connectorActor(request);const {workspaceId}=await context.params;return NextResponse.json({connectors:await listConnectors(actor,workspaceId)},{headers:connectorHeaders});}catch(error){return connectorHttpError(error);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.manage');if(permissionDenied)return permissionDenied;
try{const actor=await connectorActor(request,true);const {workspaceId}=await context.params;return NextResponse.json(await createConnector(actor,workspaceId,await connectorJson(request)),{status:201,headers:connectorHeaders});}catch(error){return connectorHttpError(error);}}
