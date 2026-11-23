import {Prisma} from '@prisma/client';
import {dashboardDb} from '../src/server/db';
import {loadAnalysisInput,prepareAnalysisInput,assertCurrentAnalysis} from '../src/features/analysis/service';
import {salesAnalysisInput} from '../src/features/sales/preparation';
import {salesSnapshotSchema,SALES_ENGINE_BASE} from '../src/engines/sales/contracts';
import {ANALYSIS_ENGINE_VERSION,type DashboardAnalysis} from '../src/engines/analysis/pipeline';
import {publishColumnarFrame,columnarEnabled} from '../src/engines/columnar/engine';

/** Resumable migration of current Dashboard standard and Sales analysis runs.
 * No tests are executed by this script. It never modifies other applications.
 * Runs whose source/revision/engine is stale are skipped, not resurrected. */
if(!columnarEnabled())throw Error('Set DASHBOARD_COLUMNAR_ENGINE=enabled to backfill analysis frames.');
const pageSize=50;
let cursor:string|undefined;
let updated=0,skipped=0;
try {
 for(;;){
  const runs=await dashboardDb.dashboardAnalysisRun.findMany({
   where:{status:'READY',...(cursor?{id:{gt:cursor}}:{})},
   orderBy:{id:'asc'},take:pageSize
  });
  if(!runs.length)break;
  for(const run of runs){
   cursor=run.id;
   if(run.engineVersion!==ANALYSIS_ENGINE_VERSION&&run.engineVersion<SALES_ENGINE_BASE){skipped++;continue;}
   const result=run.result as unknown as DashboardAnalysis;
   if(result.frame?.formatVersion===3){skipped++;continue;}
   const sales=run.engineVersion>=SALES_ENGINE_BASE;
   const parsedProfile=sales?salesSnapshotSchema.safeParse((run.result as Record<string,unknown>)?.salesProfile):null;
   const profile=parsedProfile?.success?parsedProfile.data:undefined;
   if(sales&&!profile){skipped++;continue;}
   const projection=sales?'SALES_PROJECTED' as const:'SOURCE' as const;
   let input;
   try{
    input=sales
     ?await salesAnalysisInput(run.workspaceId,run.datasetId,run.versionId,profile!.confirmation)
     :await loadAnalysisInput(run.workspaceId,run.datasetId,run.versionId);
   }catch(error){
    if(error instanceof Error&&['DATASET_UNAVAILABLE','VERSION_CONFLICT','CONFIRMATION_REQUIRED'].includes(error.message)){skipped++;continue;}
    throw error;
   }
   if(input.version.id!==run.versionId||input.version.semanticRevision!==run.semanticRevision||
      input.version.checksum!==run.sourceChecksum){skipped++;continue;}
   const prepared=await prepareAnalysisInput({...input,...(sales?{salesProfile:profile!}:{})});
   const frame=await publishColumnarFrame({
    workspaceId:run.workspaceId,datasetId:run.datasetId,versionId:run.versionId,
    semanticRevision:run.semanticRevision,sourceChecksum:run.sourceChecksum,
    engineVersion:run.engineVersion,projection,prepared,confirmation:input.confirmation
   });
   const changed=await dashboardDb.$transaction(async tx=>{
    await assertCurrentAnalysis(tx,run.workspaceId,run.datasetId,run.versionId,run.semanticRevision);
    const latest=await tx.dashboardAnalysisRun.findUnique({where:{id:run.id}});
    if(!latest||latest.status!=='READY'||latest.sourceChecksum!==run.sourceChecksum||
       latest.semanticRevision!==run.semanticRevision||latest.engineVersion!==run.engineVersion)return 0;
    const latestResult=latest.result as unknown as DashboardAnalysis;
    if(latestResult.frame?.formatVersion===3)return 0;
    await tx.dashboardAnalysisRun.update({where:{id:run.id},
     data:{result:JSON.parse(JSON.stringify({...latestResult,frame})) as Prisma.InputJsonValue}});
    return 1;
   });
   updated+=changed;
   console.log(JSON.stringify({analysisId:run.id,projection,frame:changed?'published':'already-current'}));
  }
 }
 console.log(JSON.stringify({updated,skipped,engineVersion:ANALYSIS_ENGINE_VERSION}));
} finally{await dashboardDb.$disconnect();}
