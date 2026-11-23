import {readDataModel,mutateDataModel} from '../../../../../features/data-model/service';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {dataActor,dataError,headers} from '../../../../../features/data-model/http';
import {analysisJson} from '../../../../../features/analysis/http';
import {NextResponse} from 'next/server';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await readDataModel(await dataActor(request),(await context.params).workspaceId,new URL(request.url).searchParams.get('left')??undefined,new URL(request.url).searchParams.get('right')??undefined),{headers});}catch(e){return dataError(e);}
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await mutateDataModel(await dataActor(request,true),(await context.params).workspaceId,await analysisJson(request)),{headers});}catch(e){return dataError(e);}
}
