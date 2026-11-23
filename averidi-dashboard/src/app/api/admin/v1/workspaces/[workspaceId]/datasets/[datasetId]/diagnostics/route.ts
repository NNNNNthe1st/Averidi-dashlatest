import {NextResponse} from 'next/server';
import {authorizeDashboardAdmin} from '../../../../../../../../../server/admin-access';
import {readDatasetDiagnostics} from '../../../../../../../../../features/administration/diagnostics';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string;datasetId:string}>}){
 const actor=await authorizeDashboardAdmin(request,'dashboard:read');if(!actor)return json({error:'FORBIDDEN'},403);
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>key!=='versionId')||query.getAll('versionId').length>1)return json({error:'INVALID_DIAGNOSTIC_SCOPE'},400);
 try{const {workspaceId,datasetId}=await params;return json(await readDatasetDiagnostics(actor,workspaceId,datasetId,query.get('versionId')??undefined));}
 catch(error){const code=error instanceof Error?error.message:'';return json({error:code==='NOT_FOUND'||code==='INVALID_DIAGNOSTIC_SCOPE'?code:'DIAGNOSTICS_UNAVAILABLE'},code==='NOT_FOUND'?404:code==='INVALID_DIAGNOSTIC_SCOPE'?400:503);}
}
