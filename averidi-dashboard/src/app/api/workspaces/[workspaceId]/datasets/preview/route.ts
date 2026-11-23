import {readDashboardMultipart,DashboardUploadRequestError} from '../../../../../../engines/ingestion/multipart';
import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from "next/server";
import {dashboardSameOrigin} from "../../../../../../server/request-origin";
import {getAuthenticatedDashboardActor} from "../../../../../../server/auth-boundary";
import {requireWorkspaceRole} from "../../../../../../server/workspace-access";
import {requireDashboardEntitlement} from "../../../../../../features/subscriptions/entitlements";
import {dashboardMaxFileBytes,prepareDashboardFile,DashboardIngestValidationError,DashboardWorksheetSelectionError} from "../../../../../../engines/ingestion/ingest";

type Context={params:Promise<{workspaceId:string}>};
const headers={"Cache-Control":"no-store"};
const respond=(error:string,status:number)=>NextResponse.json({error},{headers,status});

export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.write');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return respond("CROSS_ORIGIN_REQUEST",403);
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return respond("UNAUTHORIZED",401);
 const {workspaceId}=await context.params;
 if(!await requireWorkspaceRole(actor,workspaceId,"EDITOR"))return respond("FORBIDDEN",403);
 if(!await requireDashboardEntitlement(actor,workspaceId))return respond("SUBSCRIPTION_REQUIRED",402);

 let file:File,worksheetName:string|undefined,csvDelimiter:","|";"|"\t"|undefined,preserveTextFields:string[]=[];
 try{
  const form=await readDashboardMultipart(request),candidate=form.get("file"),worksheet=form.get("worksheet"),delimiter=form.get("csvDelimiter"),rawTextFields=form.get("preserveTextFields");
  if(!(candidate instanceof File)||form.getAll("file").length!==1)return respond("FILE_REQUIRED",400);
  if(worksheet!==null&&(typeof worksheet!=="string"||worksheet.length>120))return respond("INVALID_WORKSHEET",400);
  if(delimiter!==null&&delimiter!=="comma"&&delimiter!=="semicolon"&&delimiter!=="tab")return respond("INVALID_CSV_DELIMITER",400);
  csvDelimiter=delimiter==="comma"?",":delimiter==="semicolon"?";":delimiter==="tab"?"\t":undefined;
  if(rawTextFields!==null){
    if(typeof rawTextFields!=="string"||rawTextFields.length>16000)return respond("INVALID_TEXT_FIELDS",400);
    let selected:unknown;try{selected=JSON.parse(rawTextFields)}catch{return respond("INVALID_TEXT_FIELDS",400);}
    if(!Array.isArray(selected)||selected.length>100||!selected.every(x=>typeof x==="string"&&x.length>0&&x.length<=120)||new Set(selected).size!==selected.length)return respond("INVALID_TEXT_FIELDS",400);
    preserveTextFields=selected as string[];
  }
  file=candidate;worksheetName=typeof worksheet==="string"&&worksheet.trim()?worksheet:undefined;
 }catch(error){if(error instanceof DashboardUploadRequestError)return respond(error.code,error.status);return respond("INVALID_MULTIPART",400);}
 if(file.size<1||file.size>dashboardMaxFileBytes())return respond("INVALID_FILE_SIZE",413);
 if(!/\.(csv|json|xlsx)$/i.test(file.name))return respond("UNSUPPORTED_FORMAT",415);
 if(worksheetName&&!/\.xlsx$/i.test(file.name))return respond("WORKSHEET_NOT_APPLICABLE",400);
 if(csvDelimiter&&!/\.csv$/i.test(file.name))return respond("CSV_DELIMITER_NOT_APPLICABLE",400);
 try{
  const data=await prepareDashboardFile({bytes:Buffer.from(await file.arrayBuffer()),fileName:file.name,worksheetName,csvDelimiter,preserveTextFields});
  if(preserveTextFields.some(field=>!data.columns.some(column=>column.name===field)))return respond("INVALID_TEXT_FIELDS",400);
  return NextResponse.json({columns:data.columns,rowCount:data.rows.length,duplicateCount:data.duplicateCount,preview:data.preview,profile:data.profile},{headers});
 }catch(error){
  if(error instanceof DashboardIngestValidationError)return NextResponse.json({error:"INVALID_DATASET",message:error.message.slice(0,2000),...(error instanceof DashboardWorksheetSelectionError?{worksheets:error.worksheets.slice(0,100)}:{})},{status:422,headers});
  return respond("PREVIEW_FAILED",503);
 }
}
