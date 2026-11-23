import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {analysisConfirmationSchema,analyzeDashboardData} from '../src/engines/analysis/pipeline';
import {generateDashboardConfig,addDashboardWidget} from '../src/engines/generation/dashboard-templates';
import {buildDashboardWidgets} from '../src/engines/visualization/widgets';
import {renderVisualReport} from '../src/engines/reporting/visual-report';
import {reportBrandingSchema,reportSettingsSchema} from '../src/features/reports/settings';
import {normalizeReportBranding} from '../src/features/reports/branding';
import {dashboardDb as db} from '../src/server/db';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {governedWorkspace} from './fixtures/governed-workspace';
import {saveReportDefinition,listReportDefinitions} from '../src/features/reports/definitions';
import {readDashboardObject} from '../src/server/storage';
import {dispatchDueReportSchedules} from '../src/worker/queue';
import {queueInAppReportDelivery} from '../src/features/reports/delivery';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {GET as download} from '../src/app/api/workspaces/[workspaceId]/reports/exports/[exportId]/route';
after(()=>db.$disconnect());
const confirmation=analysisConfirmationSchema.parse({confirmedMappings:[{sourceField:'id',canonicalConcept:'ORDER'},{sourceField:'revenue',canonicalConcept:'REVENUE'},{sourceField:'cost',canonicalConcept:'COST'},{sourceField:'channel',canonicalConcept:'CHANNEL'}],metricRules:{versionId:'v',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'}});
async function fixture(){const prepared=await prepareDashboardFile({bytes:Buffer.from('id,revenue,cost,channel\nA,150,50,Web\nB,50,25,Shop\n'),fileName:'report.csv',preserveTextFields:['id','channel']}),analysis=analyzeDashboardData(prepared,'v',confirmation),definition=addDashboardWidget(generateDashboardConfig('SALES',analysis.outcomes),'REVENUE','BAR','channel',analysis.outcomes,['channel']);return {name:'Board report',dashboardName:definition.name,data:buildDashboardWidgets(definition,prepared,'v',confirmation,{filters:[],compare:false}),analysisId:'analysis',versionId:'v',sourceChecksum:'a'.repeat(64),generatedAt:new Date('2026-01-05T12:00:00Z')};}
test('262/263/266: native PDF and PNG are deterministic, branded, nonempty real files with exact governed metrics',async()=>{
 const input=await fixture(),logo=await sharp({create:{width:16,height:16,channels:4,background:'#118844'}}).png().toBuffer(),branding=await normalizeReportBranding({businessName:'Acme & Sons',subtitle:'Monthly <summary>',accentColor:'#118844',showAveridi:true,logoDataUrl:'data:image/png;base64,'+logo.toString('base64')});
 const pdf=await renderVisualReport({...input,branding},'PDF'),again=await renderVisualReport({...input,branding},'PDF'),png=await renderVisualReport({...input,branding},'PNG');assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.bytes.length>10000);assert.deepEqual(pdf.bytes,again.bytes);assert.equal(png.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const metadata=await sharp(png.bytes).metadata();assert.equal(metadata.width,794);assert.equal(metadata.height,1123*png.pages);assert.ok(png.pages>=1);const stats=await sharp(png.bytes).stats();assert.ok(stats.channels.some(c=>c.stdev>10));
 const dir=path.join(process.cwd(),'.local','visual-report-qa');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'branded.pdf'),pdf.bytes);await writeFile(path.join(dir,'branded.png'),png.bytes);
});
test('266: branding refuses external/SVG sources, oversized or invalid PNGs and removes image metadata',async()=>{
 for(const value of ['https://example.invalid/logo.png','file:///etc/passwd','data:image/svg+xml;base64,PHN2Zz4='])assert.equal(reportBrandingSchema.safeParse({logoDataUrl:value}).success,false);
 await assert.rejects(normalizeReportBranding({logoDataUrl:'data:image/png;base64,YQ=='}),/INVALID_REPORT_DEFINITION/);
 const huge=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(huge);huge.writeUInt32BE(100000,16);huge.writeUInt32BE(100000,20);await assert.rejects(normalizeReportBranding({logoDataUrl:'data:image/png;base64,'+huge.toString('base64')}),/INVALID_REPORT_DEFINITION/);
 assert.equal(reportBrandingSchema.safeParse({accentColor:'red; background:url(x)'}).success,false);assert.equal(reportSettingsSchema.safeParse({markup:'<svg/>'}).success,false);assert.equal(reportSettingsSchema.safeParse({branding:{unexpected:true}}).success,false);
});
test('262/263: pagination preserves all groups, cancellation and bounded image refusal',async()=>{
 const input=await fixture(),widget=input.data.widgets.at(-1)!;widget.series=Array.from({length:100},(_,i)=>({label:'Full customer label '+i+' '+('W'.repeat(100)),groupKey:String(i),missing:false,value:i-50,status:'READY',reason:null,rowCount:1,comparison:undefined,secondaryValue:null,segmentMetrics:undefined}));const pdf=await renderVisualReport(input,'PDF');assert.ok(pdf.pages>2);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(renderVisualReport(input,'PNG',cancelled.signal));
 input.data.widgets=Array.from({length:5},(_,i)=>({...widget,id:'long-'+i,title:'Long chart '+i}));await assert.rejects(renderVisualReport(input,'PNG'),/REPORT_IMAGE_LIMIT/);
});
test('262/263/266: real restricted worker produces downloadable snapshots, retains format across edits and delivers both formats',async()=>{
 const f=await governedWorkspace();try{
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.actor),request=()=>new Request('https://dashboard.test/dashboard/app/api/reports',{headers:{cookie}}),input={name:'Branded board report',viewId:f.viewId,definition:{query:{filters:[{type:'CATEGORY',field:'channel',value:'Web'}],compare:false},branding:{businessName:'Native business',subtitle:'Confidential',accentColor:'#176b44',showAveridi:false,logoDataUrl:null}}};
  const pdf=await saveReportDefinition(f.actor,f.workspace.id,{...input,format:'PDF'}),generated=await f.run('REPORT_GENERATE',{reportId:pdf.id}),file=await db.dashboardReportExport.findUniqueOrThrow({where:{id:generated.exportId}});assert.equal(file.format,'PDF');assert.equal((await readDashboardObject(file.storageKey!)).subarray(0,5).toString(),'%PDF-');
  const png=await saveReportDefinition(f.actor,f.workspace.id,{...input,format:'PNG',expectedUpdatedAt:pdf.updatedAt.toISOString()},pdf.id),image=await f.run('REPORT_GENERATE',{reportId:png.id}),art=await db.dashboardReportExport.findUniqueOrThrow({where:{id:image.exportId}});assert.equal(art.format,'PNG');
  for(const [id,mime,signature] of [[file.id,'application/pdf','255044462d'],[art.id,'image/png','89504e470d']]){const response=await download(request(),{params:Promise.resolve({workspaceId:f.workspace.id,exportId:id})});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),mime);assert.match(response.headers.get('cache-control')! ,/no-store/);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString('hex'),signature);const delivery=await queueInAppReportDelivery(f.actor,f.workspace.id,{exportId:id,userId:f.actor.userId},randomUUID());assert.equal((await runDashboardWorkerOnce()).jobId,delivery.jobId);assert.equal((await db.dashboardReportDelivery.findUniqueOrThrow({where:{id:delivery.deliveryId}})).status,'DELIVERED');}
  const schedule=await db.dashboardReportSchedule.create({data:{workspaceId:f.workspace.id,reportId:png.id,enabled:true,recipients:[{userId:f.actor.userId}],intervalSeconds:3600,nextRunAt:new Date(Date.now()-1000)}});assert.equal(await dispatchDueReportSchedules(),1);assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');const scheduled=await db.dashboardReportDelivery.findFirstOrThrow({where:{scheduleId:schedule.id},include:{export:true}});assert.equal(scheduled.export.format,'PNG');assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');assert.equal((await db.dashboardReportDelivery.findUniqueOrThrow({where:{id:scheduled.id}})).status,'DELIVERED');
  assert.equal((await listReportDefinitions(f.actor,f.workspace.id)).exports.find(e=>e.id===file.id)?.format,'PDF');assert.equal((await download(request(),{params:Promise.resolve({workspaceId:f.foreign.id,exportId:file.id})})).status,404);
  await db.dashboardReportExport.update({where:{id:art.id},data:{checksum:'0'.repeat(64)}});assert.equal((await download(request(),{params:Promise.resolve({workspaceId:f.workspace.id,exportId:art.id})})).status,404);
  await db.dashboardReportExport.update({where:{id:file.id},data:{expiresAt:new Date(0)}});assert.equal((await download(request(),{params:Promise.resolve({workspaceId:f.workspace.id,exportId:file.id})})).status,404);
  await assert.rejects(saveReportDefinition(f.reader,f.workspace.id,{...input,format:'PDF'}),/FORBIDDEN/);
 }finally{await f.cleanup();}
});
