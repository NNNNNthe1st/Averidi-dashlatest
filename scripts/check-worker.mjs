import * as contractsModule from '../src/worker/contracts.ts';
const {requiredWorkerCapabilities}=contractsModule.default??contractsModule;
import * as dbModule from '../src/server/db.ts';
const {dashboardDb}=dbModule.default??dbModule;
try{
 const recent=await dashboardDb.dashboardWorkerHeartbeat.count({where:{stopping:false,version:{gte:2},capabilities:{hasEvery:requiredWorkerCapabilities()},seenAt:{gt:new Date(Date.now()-30_000)}}});
 if(!recent)throw new Error('No healthy Dashboard worker heartbeat in the last 30 seconds.');
 console.log(JSON.stringify({healthy:true,workers:recent}));
}finally{await dashboardDb.$disconnect();}
