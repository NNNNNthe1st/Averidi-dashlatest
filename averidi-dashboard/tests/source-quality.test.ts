import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {prepareDashboardRows} from '../src/engines/ingestion/ingest';
import {sourceQualityAssessment,redactSourceQuality} from '../src/features/data-model/source-quality';
import {governedWorkspace} from './fixtures/governed-workspace';
import {readDatasetAnalysis} from '../src/features/analysis/service';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {readQuality} from '../src/features/data-model/quality';
after(()=>db.$disconnect());
test('source quality distinguishes pass, missing-cell warning, duplicates/failure and genuinely unchecked input without exposing values',()=>{
 const profile=prepareDashboardRows([{id:'ONE',amount:10,group:null},{id:'TWO',amount:20,group:'PRIVATE_VALUE_NOT_EXPOSED'}]).profile;
 const warn=sourceQualityAssessment({versionId:'sample',status:'READY',profile});assert.equal(warn.status,'WARNING');assert.deepEqual(warn.warnings,[{code:'MISSING_CELLS',field:'group',count:1}]);assert.ok(!JSON.stringify(warn).includes('PRIVATE_VALUE_NOT_EXPOSED'));assert.equal(warn.scope,'PROFILE');
 assert.equal(sourceQualityAssessment({status:'READY',profile:prepareDashboardRows([{id:'ONE',amount:10}]).profile}).status,'PASS');
 const duplicate=sourceQualityAssessment({status:'READY',profile:prepareDashboardRows([{id:'ONE'},{id:'ONE'}]).profile});assert.equal(duplicate.status,'FAIL');assert.deepEqual(duplicate.errors,[{code:'DUPLICATE_ROWS',count:1}]);
 assert.equal(sourceQualityAssessment({status:'FAILED'}).status,'FAIL');assert.equal(sourceQualityAssessment({status:'PENDING',profile}).status,null);assert.equal(sourceQualityAssessment({status:'READY',profile:{}}).status,null);
 assert.equal(sourceQualityAssessment({status:'READY',profile:{...profile,columnCount:1}}).status,null);
 assert.equal(sourceQualityAssessment({status:'READY',profile,analysisStatus:'BLOCKED'}).status,'FAIL');assert.equal(sourceQualityAssessment({status:'READY',profile,validationFailed:true}).status,'FAIL');assert.equal(sourceQualityAssessment({status:'READY',profile,validationFailed:true,validationScope:'PROFILE'}).scope,'PROFILE');assert.equal(sourceQualityAssessment({status:'READY',profile,validationFailed:true,validationScope:'GOVERNED'}).scope,'GOVERNED');
});
test('actual governed sources agree before/after analysis, on the dashboard and in quality review while numeric safeguards stay intact',async()=>{
 const f=await governedWorkspace();try{
  const original=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}}),profile=original.profile as Record<string,any>;
  const read=async()=>{const [analysis,view,quality]=await Promise.all([readDatasetAnalysis(f.reader,f.workspace.id,f.dataset.id),readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{}),readQuality(f.reader,f.workspace.id,f.dataset.id)]);return {statuses:[analysis.qualityAssessment.status,view.qualityAssessment.status,quality.qualityAssessment.status],view,quality};};
  assert.deepEqual((await read()).statuses,['PASS','PASS','PASS']);
  await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{profile:{...profile,fields:{...profile.fields,channel:{...profile.fields.channel,present:1,missing:1}}}}});
  const warning=await read();assert.deepEqual(warning.statuses,['WARNING','WARNING','WARNING']);assert.equal(warning.view.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);assert.equal(warning.view.analysis.quality.status,'PASS');assert.equal(warning.view.qualityAssessment.warnings[0].field,'channel');
  await db.dashboardAnalysisRun.update({where:{id:f.analysisId},data:{status:'BLOCKED'}});const blocked=await readDatasetAnalysis(f.reader,f.workspace.id,f.dataset.id);assert.equal(blocked.qualityAssessment.status,'FAIL');assert.equal((await readQuality(f.reader,f.workspace.id,f.dataset.id)).qualityAssessment.status,'FAIL');await assert.rejects(readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{}),/STALE_ANALYSIS/);
 }finally{await f.cleanup();}
});
test('failed first processing and current failed validation remain failed; stale checks do not poison a corrected source',async()=>{
 const f=await governedWorkspace();try{
  const v=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}});
  const check=await db.dashboardQualityCheck.create({data:{workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:f.versionId,kind:'DATASET_VALIDATION',status:'FAIL',createdAt:new Date(Date.now()-60000),rule:{scope:'GOVERNED',semanticRevision:v.semanticRevision,sourceChecksum:v.checksum},checkedAt:new Date()}});
  await db.dashboardQualityCheck.createMany({data:Array.from({length:21},()=>({workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:f.versionId,kind:'DATASET_VALIDATION',status:'PASS',rule:{scope:'PROFILE',semanticRevision:v.semanticRevision,sourceChecksum:v.checksum},checkedAt:new Date()}))});
  assert.equal((await readQuality(f.reader,f.workspace.id,f.dataset.id)).checks.length,20);assert.equal((await readQuality(f.reader,f.workspace.id,f.dataset.id)).qualityAssessment.status,'FAIL');assert.equal((await readDatasetAnalysis(f.reader,f.workspace.id,f.dataset.id)).qualityAssessment.status,'FAIL');assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{})).qualityAssessment.status,'FAIL');await db.dashboardQualityCheck.update({where:{id:check.id},data:{rule:{scope:'GOVERNED',semanticRevision:v.semanticRevision-1,sourceChecksum:v.checksum}}});assert.equal((await readDatasetAnalysis(f.reader,f.workspace.id,f.dataset.id)).qualityAssessment.status,'PASS');assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{})).qualityAssessment.status,'PASS');assert.equal((await readQuality(f.reader,f.workspace.id,f.dataset.id)).qualityAssessment.status,'PASS');
  await db.dashboardDataset.update({where:{id:f.dataset.id},data:{activeVersionId:null,status:'INGESTING'}});await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{status:'FAILED',profile:{}}});assert.equal((await readQuality(f.reader,f.workspace.id,f.dataset.id)).qualityAssessment.status,'FAIL');
 }finally{await f.cleanup();}
});

test('restricted quality summaries omit field names/counts, and foreign actors cannot retrieve quality or calculation metadata',async()=>{
 const profile=prepareDashboardRows([{id:'one',sensitive_salary:null},{id:'two',sensitive_salary:200}]).profile,redacted=redactSourceQuality(sourceQualityAssessment({versionId:'known-view-version',status:'READY',profile}));assert.equal(redacted.status,'WARNING');assert.equal(redacted.rows,null);assert.deepEqual(redacted.warnings,[{code:'MISSING_CELLS'}]);assert.ok(!JSON.stringify(redacted).includes('sensitive_salary'));
 const f=await governedWorkspace();try{await assert.rejects(readQuality(f.reader,f.foreign.id,f.dataset.id),/FORBIDDEN/);await assert.rejects(readDatasetAnalysis(f.reader,f.foreign.id,f.dataset.id),/FORBIDDEN/);await assert.rejects(readWorkspaceDashboardData(f.reader,f.foreign.id,f.viewId,{}),/FORBIDDEN/);}finally{await f.cleanup();}
});
