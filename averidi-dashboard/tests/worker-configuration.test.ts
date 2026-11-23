import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {dashboardWorkerSettings} from '../src/worker/settings';
import {normalizeWorkerPayload} from '../src/worker/contracts';
test('worker is disabled by default in standalone environment',()=>{
 const example=readFileSync(join(process.cwd(),'.env.example'),'utf8');assert.match(example,/^DASHBOARD_WORKER_ENABLED=false$/m);assert.throws(()=>dashboardWorkerSettings({DASHBOARD_WORKER_ENABLED:'false'}));
});
test('worker settings and payload contracts reject unsafe limits and implicit fields',()=>{
 assert.deepEqual(dashboardWorkerSettings({DASHBOARD_WORKER_ENABLED:'true'}),{poll:1000,timeout:600000});
 for(const timeout of ['0','NaN','1800001'])assert.throws(()=>dashboardWorkerSettings({DASHBOARD_WORKER_ENABLED:'true',DASHBOARD_WORKER_JOB_TIMEOUT_MS:timeout}));
 assert.throws(()=>normalizeWorkerPayload('UNKNOWN',{}),/UNSUPPORTED_JOB_KIND/);
 assert.throws(()=>normalizeWorkerPayload('DATASET_PROFILE',{datasetId:'dataset',versionId:'version',format:'csv',worksheetName:'Sheet'}),/INVALID_JOB_PAYLOAD/);
 assert.throws(()=>normalizeWorkerPayload('DATA_CLEANUP',{temporaryKeys:[],workspaceId:'forged'}),/INVALID_JOB_PAYLOAD/);
});
