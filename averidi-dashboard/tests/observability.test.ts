import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {observeDuration,flushObservations,requestSpanProcessor,operationalSnapshot} from '../src/features/observability/metrics';
import {safeObservationRoute,structuredDiagnostic} from '../src/features/observability/contracts';
import {infrastructureHealthy} from '../scripts/monitoring/probes.mjs';
after(()=>db.$disconnect());
test('structured diagnostics and aggregation labels cannot leak raw URLs, IDs, payloads or exceptions',()=>{
 assert.equal(safeObservationRoute('/api/workspaces/private-id/datasets?token=secret'),'OTHER');assert.equal(safeObservationRoute('/api/workspaces/[workspaceId]/datasets'),'/api/workspaces/[workspaceId]/datasets');
 const log=structuredDiagnostic('request_failed',{route:'/private-secret?token=secret',kind:'invalid secret',outcome:'secret',durationMs:12});assert.equal(log.includes('secret'),false);assert.equal(JSON.parse(log).route,'OTHER');
});
test('native aggregate upserts preserve concurrent counts and means without retaining customer data',async()=>{
 const window=new Date(Math.floor(Date.now()/60000)*60000),name='/api/health/ready',where={window,kind:'REQUEST',name};
 await db.dashboardObservationBucket.deleteMany({where});try{
  observeDuration('REQUEST',name,'2xx',10);observeDuration('REQUEST',name,'2xx',30);await flushObservations();observeDuration('REQUEST',name,'2xx',50);await flushObservations();
  const row=await db.dashboardObservationBucket.findFirstOrThrow({where});assert.equal(row.count,3);assert.equal(row.totalMs,90);assert.equal(row.maxMs,50);
  assert.ok((await operationalSnapshot()).buckets.some(b=>b.name===name&&b.meanMs===30));
 }finally{await db.dashboardObservationBucket.deleteMany({where});}
});
test('Next server spans record actual status and latency once; nested spans and arbitrary attribute data are ignored',async()=>{
 const window=new Date(Math.floor(Date.now()/60000)*60000),where={window,kind:'REQUEST',name:'OTHER'};await db.dashboardObservationBucket.deleteMany({where});
 try{const processor=requestSpanProcessor();processor.onEnd({kind:0,attributes:{'next.span_type':'BaseServer.handleRequest'},duration:[0,1000000]});processor.onEnd({kind:1,attributes:{'next.span_type':'BaseServer.handleRequest','http.status_code':201,'http.target':'/secret?password=hidden','next.route':'/unknown-secret'},duration:[0,25000000]});await processor.forceFlush();const rows=await db.dashboardObservationBucket.findMany({where});assert.equal(rows.length,1);assert.equal(rows[0].maxMs,25);assert.equal(rows[0].outcome,'2xx');assert.equal(JSON.stringify(rows).includes('secret'),false);}finally{await db.dashboardObservationBucket.deleteMany({where});}
});
test('infrastructure probes reject missing and nonfinite metrics and enforce configured resource thresholds',()=>{
 const config={cpuLoadPerCore:2,memoryPercent:95,diskPercent:90};assert.equal(infrastructureHealthy({loadPerCore:1,usedMemoryPercent:50,usedDiskPercent:50},config),true);for(const value of [{loadPerCore:NaN,usedMemoryPercent:0,usedDiskPercent:0},{loadPerCore:3,usedMemoryPercent:50,usedDiskPercent:50},{loadPerCore:1,usedMemoryPercent:99,usedDiskPercent:50},{loadPerCore:1,usedMemoryPercent:50,usedDiskPercent:99}])assert.equal(infrastructureHealthy(value,config),false);
});
test('operator database probes detect refresh/metric incidents and actual request errors/latency',async()=>{
 const {probeChild}=await import('../scripts/monitoring/probes.mjs'),workspace=await db.dashboardWorkspace.create({data:{name:'Operator metric probes'}}),source=await db.dashboardDataSource.create({data:{workspaceId:workspace.id,name:'Probe source',kind:'FILE'}}),window=new Date(Math.floor(Date.now()/60000)*60000),where={window,kind:'REQUEST',name:'/api/health/ready'};
 const env={...process.env,DASHBOARD_MONITOR_READY_URL:'https://localhost/dashboard/app/api/health/ready'},probe=(name:string)=>probeChild(['--import','tsx','scripts/monitoring/database.mjs',name],env);
 try{
  await db.dashboardSourceIncident.create({data:{workspaceId:workspace.id,sourceId:source.id,kind:'REFRESH_FAILURE',code:'SOURCE_REFRESH_FAILED'}});assert.equal(await probe('refreshFailures'),false);
  await db.dashboardSourceIncident.create({data:{workspaceId:workspace.id,sourceId:source.id,kind:'METRIC_FAILURE',code:'METRIC_PROCESSING_FAILED'}});assert.equal(await probe('metricFailures'),false);
  observeDuration('REQUEST',where.name,'5xx',20000);observeDuration('JOB','METRICS_CALCULATE','COMPLETED',700000);await flushObservations();assert.equal(await probe('requestErrors'),false);assert.equal(await probe('requestLatency'),false);assert.equal(await probe('jobLatency'),false);
  await db.dashboardSourceIncident.updateMany({where:{workspaceId:workspace.id},data:{status:'RESOLVED'}});await db.dashboardObservationBucket.deleteMany({where});assert.equal(await probe('refreshFailures'),true);assert.equal(await probe('metricFailures'),true);
 }finally{await db.dashboardObservationBucket.deleteMany({where:{window,kind:'JOB',name:'METRICS_CALCULATE'}});await db.dashboardObservationBucket.deleteMany({where});await db.dashboardWorkspace.delete({where:{id:workspace.id}});}
});
