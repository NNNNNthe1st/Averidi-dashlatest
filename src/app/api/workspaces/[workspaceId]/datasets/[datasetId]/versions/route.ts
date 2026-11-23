import {readDashboardMultipart,DashboardUploadRequestError} from '../../../../../../../engines/ingestion/multipart';
import {setAuditActor} from '../../../../../../../features/audit/context';
import {quotaHttpError} from '../../../../../../../features/quotas/http';
import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {createHash,randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {getAuthenticatedDashboardActor} from "../../../../../../../server/auth-boundary";
import {dashboardSameOrigin} from "../../../../../../../server/request-origin";
import {requireWorkspaceRole} from "../../../../../../../server/workspace-access";
import {requireDashboardEntitlement} from "../../../../../../../features/subscriptions/entitlements";
import {dashboardDb} from "../../../../../../../server/db";
import {dashboardStorageKey} from "../../../../../../../server/storage";
import {readWorkspaceObject,writeWorkspaceObject,deleteUncommittedWorkspaceUpload} from "../../../../../../../server/workspace-storage";
import {dashboardMaxFileBytes,prepareDashboardFile,DashboardIngestValidationError,DashboardWorksheetSelectionError} from "../../../../../../../engines/ingestion/ingest";
import {prepareDashboardAppend} from "../../../../../../../features/datasets/append";
import {prepareDashboardSynchronization} from "../../../../../../../features/datasets/synchronize";

type Ctx={params:Promise<{workspaceId:string;datasetId:string}>};
const headers={"Cache-Control":"no-store"};
const respond=(error:string,status:number)=>NextResponse.json({error},{status,headers});

export async function GET(request:Request,context:Ctx){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return respond("UNAUTHORIZED",401);
 const {workspaceId,datasetId}=await context.params;
 if(!await requireWorkspaceRole(actor,workspaceId,"VIEWER"))return respond("FORBIDDEN",403);
 if(!await requireDashboardEntitlement(actor,workspaceId))return respond("SUBSCRIPTION_REQUIRED",402);
 const dataset=await dashboardDb.dashboardDataset.findFirst({where:{id:datasetId,workspaceId},select:{activeVersionId:true,status:true}});
 if(!dataset)return respond("DATASET_UNAVAILABLE",404);
 const versions=await dashboardDb.dashboardDatasetVersion.findMany({where:{datasetId},orderBy:{version:"desc"},take:100,select:{id:true,version:true,status:true,sourceFormat:true,importMode:true,recordIdentityField:true,importSummary:true,rowCount:true,createdAt:true,profiledAt:true}});
 return NextResponse.json({activeVersionId:dataset.activeVersionId,datasetStatus:dataset.status,versions},{headers});
}


/** First-party, authorized, validated imports; existing verified data stays active until worker approval. */
export async function POST(request:Request,context:Ctx){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.write');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return respond("CROSS_ORIGIN_REQUEST",403);
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return respond("UNAUTHORIZED",401);
 const {workspaceId,datasetId}=await context.params;
 if(!await requireWorkspaceRole(actor,workspaceId,"EDITOR"))return respond("FORBIDDEN",403);
 if(!await requireDashboardEntitlement(actor,workspaceId))return respond("SUBSCRIPTION_REQUIRED",402);

 let file:File,worksheetName:string|undefined,mode:"REPLACE"|"APPEND"|"SYNCHRONIZE",recordIdentityField:string|undefined,completeSnapshot:boolean,preserveTextFields:string[],csvDelimiter:","|";"|"\t"|undefined;
 try{
  const form=await readDashboardMultipart(request);
  const candidate=form.get("file"),worksheet=form.get("worksheet"),rawMode=form.get("mode")??"REPLACE",identity=form.get("recordIdentityField"),snapshot=form.get("completeSnapshot"),rawTextFields=form.get("preserveTextFields"),delimiter=form.get("csvDelimiter");
  if(!(candidate instanceof File)||form.getAll("file").length!==1)return respond("FILE_REQUIRED",400);
  if(worksheet!==null&&(typeof worksheet!=="string"||worksheet.length>120))return respond("INVALID_WORKSHEET",400);
  if(rawMode!=="REPLACE"&&rawMode!=="APPEND"&&rawMode!=="SYNCHRONIZE")return respond("INVALID_IMPORT_MODE",400);
  if(identity!==null&&(typeof identity!=="string"||identity.length>120))return respond("INVALID_RECORD_IDENTITY",400);
  if(rawTextFields!==null&&(typeof rawTextFields!=="string"||rawTextFields.length>16000))return respond("INVALID_TEXT_FIELDS",400);
  let selected:unknown=[];
  if(typeof rawTextFields==="string"){try{selected=JSON.parse(rawTextFields)}catch{return respond("INVALID_TEXT_FIELDS",400);}}
  if(!Array.isArray(selected)||selected.length>100||!selected.every(x=>typeof x==="string"&&x.length>0&&x.length<=120)||new Set(selected).size!==selected.length)return respond("INVALID_TEXT_FIELDS",400);
  if(delimiter!==null&&delimiter!=="comma"&&delimiter!=="semicolon"&&delimiter!=="tab")return respond("INVALID_CSV_DELIMITER",400);
  csvDelimiter=delimiter==="comma"?",":delimiter==="semicolon"?";":delimiter==="tab"?"\t":undefined;
  preserveTextFields=selected as string[];
  file=candidate;worksheetName=typeof worksheet==="string"&&worksheet.trim()?worksheet:undefined;
  mode=rawMode;
  completeSnapshot=snapshot==="true";
  if(snapshot!==null&&snapshot!=="true"&&snapshot!=="false")return respond("INVALID_SNAPSHOT_FLAG",400);
  if(mode==="SYNCHRONIZE"&&!completeSnapshot)return respond("COMPLETE_SNAPSHOT_REQUIRED",400);
  recordIdentityField=typeof identity==="string"&&identity.trim()?identity.trim():undefined;
  if((mode==="APPEND"||mode==="SYNCHRONIZE")&&!recordIdentityField)return respond("RECORD_IDENTITY_REQUIRED",400);
 }catch(error){if(error instanceof DashboardUploadRequestError)return respond(error.code,error.status);return respond("INVALID_MULTIPART",400);}
 if(file.size<1||file.size>dashboardMaxFileBytes())return respond("INVALID_FILE_SIZE",413);
 const ext=file.name.toLowerCase().match(/\.(csv|xlsx|json)$/)?.[1];
 if(!ext)return respond("UNSUPPORTED_FORMAT",415);
 if(worksheetName&&ext!=="xlsx")return respond("WORKSHEET_NOT_APPLICABLE",400);
 if(csvDelimiter&&ext!=="csv")return respond("CSV_DELIMITER_NOT_APPLICABLE",400);

 const current=await dashboardDb.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:{not:"ARCHIVED"}},select:{activeVersionId:true}});
 if(!current)return respond("DATASET_UNAVAILABLE",404);
 const expectedActiveVersionId=current.activeVersionId;
 if(await dashboardDb.dashboardDatasetVersion.findFirst({where:{datasetId,status:"PENDING"},select:{id:true}}))return respond("IMPORT_IN_PROGRESS",409);
 let bytes=Buffer.from(await file.arrayBuffer()),format=ext,storedWorksheet=worksheetName;
 let summary:Record<string,unknown>={mode,inputBytes:bytes.length};
 try{
  const incoming=await prepareDashboardFile({bytes,fileName:file.name,worksheetName,csvDelimiter,preserveTextFields});
  if(preserveTextFields.some(field=>!incoming.columns.some(column=>column.name===field)))return respond("INVALID_TEXT_FIELDS",400);
  if(mode==="APPEND"||mode==="SYNCHRONIZE"){
   if(!expectedActiveVersionId)return respond("IMPORT_REQUIRES_ACTIVE_VERSION",409);
   const active=await dashboardDb.dashboardDatasetVersion.findFirst({
    where:{id:expectedActiveVersionId,datasetId,status:"READY"},
    select:{storageKey:true,sourceFormat:true,sourceWorksheetName:true,fileSize:true,checksum:true,importSummary:true},
   });
   if(!active||!["CSV","JSON","XLSX"].includes(active.sourceFormat))return respond("IMPORT_REQUIRES_KNOWN_SOURCE",409);
   const previousBytes=await readWorkspaceObject(actor,workspaceId,active.storageKey);
   if(previousBytes.length!==Number(active.fileSize)||createHash("sha256").update(previousBytes).digest("hex")!==active.checksum)
    return respond("ACTIVE_SOURCE_INTEGRITY_FAILURE",409);
   const priorSettings=active.importSummary&&typeof active.importSummary==="object"&&!Array.isArray(active.importSummary)?active.importSummary as Record<string,unknown>:{};
   const previousDelimiter=priorSettings.csvDelimiter;
   const previousTextFields=priorSettings.preserveTextFields;
   const prior=await prepareDashboardFile({bytes:previousBytes,fileName:"active."+active.sourceFormat.toLowerCase(),worksheetName:active.sourceWorksheetName??undefined,csvDelimiter:previousDelimiter===","||previousDelimiter===";"||previousDelimiter==="\t"?previousDelimiter:undefined,preserveTextFields:Array.isArray(previousTextFields)?previousTextFields.filter((field):field is string=>typeof field==="string"):undefined});
   const merged=mode==="APPEND"?prepareDashboardAppend(prior.rows,incoming.rows,recordIdentityField!):prepareDashboardSynchronization(prior.rows,incoming.rows,recordIdentityField!,{completeSnapshot:true});
   bytes=Buffer.from(JSON.stringify(merged.prepared.rows));
   if(bytes.length>dashboardMaxFileBytes())return respond("COMBINED_DATASET_TOO_LARGE",413);
   format="json";storedWorksheet=undefined;
   summary=mode==="APPEND"?{mode:"APPEND",inputRows:incoming.rows.length,previousRows:prior.rows.length,addedRows:(merged as ReturnType<typeof prepareDashboardAppend>).addedRows,duplicateRowsSkipped:(merged as ReturnType<typeof prepareDashboardAppend>).duplicateRowsSkipped,overlapRows:(merged as ReturnType<typeof prepareDashboardAppend>).overlapRows}:{mode:"SYNCHRONIZE",inputRows:incoming.rows.length,previousRows:prior.rows.length,addedRows:(merged as ReturnType<typeof prepareDashboardSynchronization>).added,updatedRows:(merged as ReturnType<typeof prepareDashboardSynchronization>).updated,removedRows:(merged as ReturnType<typeof prepareDashboardSynchronization>).removed};
  }else{
   summary={mode:"REPLACE",inputRows:incoming.rows.length,rawContentHash:String((incoming.profile.provenance as {rawContentHash:string}).rawContentHash),processedContentHash:incoming.contentHash,preserveTextFields,...(csvDelimiter?{csvDelimiter}:{})};
  }
 }catch(error){
  if(error instanceof DashboardIngestValidationError)return NextResponse.json({error:"INVALID_DATASET",message:error.message.slice(0,2000),...(error instanceof DashboardWorksheetSelectionError?{worksheets:error.worksheets.slice(0,100)}:{})},{status:422,headers});
  return respond("SOURCE_UNAVAILABLE",503);
 }
 const versionId=randomUUID(),storageKey=dashboardStorageKey(workspaceId,datasetId,versionId);
 const checksum=createHash("sha256").update(bytes).digest("hex");
 try{await writeWorkspaceObject(actor,workspaceId,storageKey,bytes);}
 catch(error){
  // A storage provider may persist bytes before reporting a failed write.
  // This key is freshly generated and has not been registered as a version.
  try{await deleteUncommittedWorkspaceUpload(actor,workspaceId,storageKey);}
  catch(cleanupError){
   const code=(cleanupError as NodeJS.ErrnoException)?.code;
   if(code!=="ENOENT"&&code!=="DASHBOARD_OBJECT_NOT_FOUND")console.error("DASHBOARD_UPLOAD_WRITE_CLEANUP_FAILED",{versionId,error:cleanupError instanceof Error?cleanupError.message:"unknown"});
  }
  const quota=quotaHttpError(error);if(quota)return quota;return respond("STORAGE_UNAVAILABLE",503);
 }
 try{
  const created=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor);
   if(request.headers.get('X-Averidi-Sales-Upload')==='1'){
    await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
    const views=await tx.dashboardView.findMany({where:{workspaceId,datasetId},select:{definition:true}});
    if(views.some(v=>(v.definition as {template?:string})?.template!=='SALES'))throw Error('SALES_SOURCE_SHARED');
   }
   const owner=await tx.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:{not:"ARCHIVED"}},select:{activeVersionId:true}});
   if(!owner)throw new Error("DATASET_UNAVAILABLE");
   if(owner.activeVersionId!==expectedActiveVersionId)throw new Error("VERSION_CONFLICT");
   const pending=await tx.dashboardDatasetVersion.findFirst({where:{datasetId,status:"PENDING"},select:{id:true}});
   if(pending)throw new Error("IMPORT_IN_PROGRESS");
   const latest=await tx.dashboardDatasetVersion.findFirst({where:{datasetId},orderBy:{version:"desc"},select:{version:true}});
   const next=(latest?.version??0)+1;
   const version=await tx.dashboardDatasetVersion.create({data:{
    id:versionId,datasetId,version:next,status:"PENDING",sourceFormat:format.toUpperCase(),
    sourceWorksheetName:storedWorksheet,importMode:mode,recordIdentityField:mode==="REPLACE"?null:recordIdentityField,
    importSummary:summary as Prisma.InputJsonValue,storageKey,fileSize:BigInt(bytes.length),checksum,
   },select:{id:true,version:true}});
   await tx.dashboardJob.create({data:{workspaceId,kind:"DATASET_PROFILE",status:"QUEUED",
    idempotencyKey:"profile_"+versionId,payload:{datasetId,versionId,format,...(storedWorksheet?{worksheetName:storedWorksheet}:{}),...(mode==="REPLACE"&&preserveTextFields.length?{preserveTextFields}:{}),...(mode==="REPLACE"&&csvDelimiter?{csvDelimiter}:{})}}});
   if(!owner.activeVersionId)await tx.dashboardDataset.update({where:{id:datasetId},data:{status:"INGESTING"}});
   return version;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  return NextResponse.json({version:created,queued:true,summary},{status:202,headers});
 }catch(error){
  // Storage was written before the serializable database transaction.
  // A failed commit must not permanently orphan the newly uploaded object.
  // If a version was nevertheless registered, do not delete its source.
  try{
   const retained=await dashboardDb.dashboardDatasetVersion.findUnique({where:{id:versionId},select:{id:true}});
   if(!retained)await deleteUncommittedWorkspaceUpload(actor,workspaceId,storageKey);
  }catch(cleanupError){
   console.error("DASHBOARD_UPLOAD_ORPHAN_CLEANUP_FAILED",{versionId,storageKey,error:cleanupError instanceof Error?cleanupError.message:"unknown"});
  }
  const quota=quotaHttpError(error);if(quota)return quota;
  if(error instanceof Error&&["IMPORT_IN_PROGRESS","VERSION_CONFLICT","SALES_SOURCE_SHARED"].includes(error.message))return respond(error.message,409);
  if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2034"].includes(error.code))return respond("VERSION_CONFLICT",409);
  return respond("UPLOAD_COMMIT_FAILED",503);
 }
}
