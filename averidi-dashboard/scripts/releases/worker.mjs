import * as workerModule from '../../src/worker/service.ts';
import * as dbModule from '../../src/server/db.ts';
const {serveDashboardWorker}=workerModule.default??workerModule,{dashboardDb}=dbModule.default??dbModule;
const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
serveDashboardWorker(controller.signal,()=>process.send?.({product:'averidi-dashboard',ready:true})).catch(()=>{console.error('RELEASE_WORKER_FAILED');process.exitCode=1;}).finally(()=>dashboardDb.$disconnect());
