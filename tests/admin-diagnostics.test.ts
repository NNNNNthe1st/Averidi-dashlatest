import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {GET as diagnostics} from '../src/app/api/admin/v1/workspaces/[workspaceId]/datasets/[datasetId]/diagnostics/route';
import {mutateCustomMetric} from '../src/features/custom-metrics/service';
import {GET as jobs} from '../src/app/api/admin/v1/jobs/route';
after(()=>db.$disconnect());
test('privileged mapping, refresh and metric diagnostics inspect scoped metadata with verified admin access',async t=>{
 const f=await governedWorkspace(),keys=['DASHBOARD_ADMIN_OIDC_ISSUER','DASHBOARD_ADMIN_OIDC_AUDIENCE','DASHBOARD_ADMIN_OIDC_JWKS_URL','DASHBOARD_ADMIN_BRIDGE_ENABLED'] as const,prior=keys.map(key=>[key,process.env[key]] as const);
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'diagnostics-admin',alg:'RS256'};
 const server=https.createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},(_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const issuer=`https://127.0.0.1:${(server.address() as {port:number}).port}`;
 Object.assign(process.env,{DASHBOARD_ADMIN_OIDC_ISSUER:issuer,DASHBOARD_ADMIN_OIDC_AUDIENCE:'diagnostics-fixture',DASHBOARD_ADMIN_OIDC_JWKS_URL:issuer+'/jwks',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false'});
 const token=async(permission='dashboard:read',tokenUse='access')=>new SignJWT({token_use:tokenUse,dashboard_permissions:[permission]}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('diagnostics-fixture').setSubject('diagnostic-operator').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const readToken=await token();const request=(suffix='',bearer=readToken)=>new Request('https://dashboard.test/dashboard/app/api/admin/v1/workspaces/'+f.workspace.id+'/datasets/'+f.dataset.id+'/diagnostics'+suffix,{headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),'x-dashboard-role':'OWNER'}});
 const params=(workspaceId=f.workspace.id,datasetId=f.dataset.id)=>({params:Promise.resolve({workspaceId,datasetId})});
 const marker='PRIVATE_ROW_PREVIEW_CREDENTIAL_MUST_NOT_APPEAR';
 try{
  await t.test('unsigned, forged, ordinary ID tokens and wrong permissions are denied before inspection',async()=>{
   const before=await db.dashboardAdminAudit.count({where:{workspaceId:f.workspace.id,action:'DATASET_DIAGNOSTICS_READ'}});
   for(const bearer of ['', 'forged',await token('dashboard:read','id'),await token('not:admin')]){assert.equal((await diagnostics(request('',bearer),params())).status,403);assert.equal((await jobs(request('',bearer))).status,403);}
   assert.equal(await db.dashboardAdminAudit.count({where:{workspaceId:f.workspace.id,action:'DATASET_DIAGNOSTICS_READ'}}),before);
  });
  await t.test('current inputs, formulas, definition lineage and mapping metadata are bounded and omit source values',async()=>{
   const definition={datasetId:f.dataset.id,analysisId:f.analysisId,name:'Diagnostic formula',description:'Governed diagnostic contribution',expression:'REVENUE - COST',format:'CURRENCY',query:{filters:[],compare:false},confirmed:true};const preview:any=await mutateCustomMetric(f.actor,f.workspace.id,{action:'PREVIEW',definition});await mutateCustomMetric(f.actor,f.workspace.id,{action:'CREATE',definition,expectedPreview:preview.reviewToken});
   const v=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}});const semantics=v.semantics as Record<string,unknown>;
   await db.dashboardDatasetVersion.update({where:{id:v.id},data:{profile:{preview:[{email:marker}],secret:marker},semantics:{...semantics,preview:[{secret:marker}],credential:marker} as any}});
   const response=await diagnostics(request(),params());assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);const body=await response.json();assert.ok(!JSON.stringify(body).includes(marker));assert.equal(body.version.id,f.versionId);assert.equal(body.analysis.current,true);assert.equal(body.analysis.sourceBytesVerified,false);
   const revenue=body.analysis.metrics.find((m:any)=>m.key==='REVENUE');assert.equal(revenue.definition.formula,'SUM(net revenue)');assert.deepEqual(revenue.requiredMappings,[{concept:'REVENUE',fields:['amount']}]);assert.ok(revenue.lineage.definitionVersion);assert.ok(!('value' in revenue));assert.ok(!('storageKey' in body.version));assert.equal(body.customMetrics.length,1);assert.equal(body.customMetrics[0].current,true);assert.equal(body.customMetrics[0].definition.expression,'REVENUE - COST');assert.ok(body.customMetrics[0].inputs.every((input:any)=>!('value' in input)));assert.ok(!('preview' in body.customMetrics[0]));assert.ok(body.mapping.fields.some((r:any)=>r.sourceName==='amount'&&r.confirmedConcept==='REVENUE'));
   const audit=await db.dashboardAdminAudit.findFirstOrThrow({where:{workspaceId:f.workspace.id,action:'DATASET_DIAGNOSTICS_READ'},orderBy:{createdAt:'desc'}});assert.equal(audit.actorSubject,'diagnostic-operator');assert.equal(JSON.parse(audit.details!).versionId,f.versionId);assert.ok(!audit.details!.includes(marker));
  });
  await t.test('scope mismatches and invalid version/query inputs cannot cross workspace boundaries',async()=>{
   assert.equal((await diagnostics(request(),params(f.foreign.id))).status,404);assert.equal((await diagnostics(request('?versionId=foreign_version'),params())).status,404);
   for(const suffix of ['?versionId=one&versionId=two','?versionId=../bad','?extra=ignored'])assert.equal((await diagnostics(request(suffix),params())).status,400);
  });
  await t.test('missing confirmation is explicit and unready analysis is never labeled current',async()=>{
   await db.dashboardAnalysisRun.update({where:{id:f.analysisId},data:{status:'BLOCKED'}});const blocked=await (await diagnostics(request(),params())).json();assert.equal(blocked.analysis.current,false);assert.ok(blocked.analysis.metrics.length);await db.dashboardAnalysisRun.update({where:{id:f.analysisId},data:{status:'READY'}});
   const v=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}});const raw=v.semantics as Record<string,unknown>;
   await db.dashboardDatasetVersion.update({where:{id:v.id},data:{semantics:{...raw,confirmedMappings:[],metricRules:null} as any}});
   const body=await (await diagnostics(request(),params())).json();assert.ok(body.mapping.problems.includes('MAPPING_CONFIRMATION_REQUIRED'));assert.ok(body.mapping.problems.includes('METRIC_RULES_REQUIRED'));assert.equal(body.analysis.current,false);assert.equal(body.customMetrics[0].current,false);
   await db.dashboardDatasetVersion.update({where:{id:v.id},data:{semantics:raw as any,semanticRevision:{increment:1}}});assert.equal((await (await diagnostics(request(),params())).json()).analysis,null);
  });
  await t.test('failed-job diagnostics filter and paginate exact scopes and sanitize arbitrary failure strings',async()=>{
   const created=await db.dashboardJob.createMany({data:[{workspaceId:f.workspace.id,kind:'CONNECTOR_SYNC',status:'FAILED',attempts:3,payload:{credential:marker},result:{preview:marker},lastError:'CONNECTOR_AUTH_REQUIRED'},{workspaceId:f.workspace.id,kind:'CONNECTOR_SYNC',status:'FAILED',attempts:3,payload:{},lastError:marker},{workspaceId:f.foreign.id,kind:'CONNECTOR_SYNC',status:'FAILED',payload:{},lastError:'CONNECTOR_NETWORK_ERROR'}]});assert.equal(created.count,3);
   const jobRequest=(query:string)=>new Request('https://dashboard.test/dashboard/app/api/admin/v1/jobs'+query,{headers:{authorization:'Bearer '+readToken}});
   const query='?workspaceId='+f.workspace.id+'&status=FAILED&limit=1';const response=await jobs(jobRequest(query));assert.equal(response.status,200);const first=await response.json();assert.equal(first.items.length,1);assert.ok(first.nextCursor);
   const second=await (await jobs(jobRequest(query+'&cursor='+first.nextCursor))).json();assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);assert.equal(second.nextCursor,null);
   const all=[...first.items,...second.items];assert.deepEqual(new Set(all.map(x=>x.errorCode)),new Set(['CONNECTOR_AUTH_REQUIRED','PROCESSING_FAILED']));assert.ok(all.every(x=>x.workspaceId===f.workspace.id&&!('payload' in x)&&!('result' in x)&&!('lastError' in x)));assert.ok(!JSON.stringify(all).includes(marker));
   for(const suffix of ['?status=UNKNOWN','?workspaceId=one&workspaceId=two','?limit=101','?status=FAILED&status=RUNNING'])assert.equal((await jobs(jobRequest(suffix))).status,400);
  });
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));for(const [key,value] of prior){if(value===undefined)delete process.env[key];else process.env[key]=value;}await f.cleanup();}
});
