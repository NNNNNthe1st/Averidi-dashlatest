import * as dbModule from '../../src/server/db.ts';
import {monitoringConfig} from './policy.mjs';
const {dashboardDb:db}=dbModule.default??dbModule;
const config=monitoringConfig(process.env),signal=process.argv[2];
try{
 const count=await db.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
  const [clock]=await tx.$queryRaw`SELECT now() AT TIME ZONE 'UTC' AS now`;
  const now=clock.now,since=new Date(now.getTime()-config.windowSeconds*1000);
  if(signal==='failedJobs')return tx.dashboardJob.count({where:{status:'FAILED',finishedAt:{gte:since,lte:now}}});
  if(signal==='queueDelay')return tx.dashboardJob.count({where:{status:'QUEUED',availableAt:{lte:new Date(now.getTime()-config.queueSeconds*1000)}}});
  if(signal==='expiredLeases')return tx.dashboardJob.count({where:{status:'RUNNING',leaseExpiresAt:{lt:now}}});
  if(signal==='operationalErrors')return tx.dashboardOperationalEvent.count({where:{severity:{in:['ERROR','CRITICAL']},createdAt:{gte:since,lte:now}}});
  if(signal==='refreshFailures')return tx.dashboardSourceIncident.count({where:{kind:'REFRESH_FAILURE',status:{in:['OPEN','ACKNOWLEDGED']}}});
  if(signal==='metricFailures')return tx.dashboardSourceIncident.count({where:{kind:'METRIC_FAILURE',status:{in:['OPEN','ACKNOWLEDGED']}}});
  if(signal==='requestErrors'){const value=await tx.dashboardObservationBucket.aggregate({where:{kind:'REQUEST',outcome:'5xx',window:{gte:since,lte:now}},_sum:{count:true}});return value._sum.count??0;}
  if(signal==='requestLatency')return tx.dashboardObservationBucket.count({where:{kind:'REQUEST',window:{gte:since,lte:now},maxMs:{gt:config.requestMaxMs}}});
  if(signal==='jobLatency')return tx.dashboardObservationBucket.count({where:{kind:'JOB',window:{gte:since,lte:now},maxMs:{gt:config.jobMaxMs}}});
  throw Error('MONITOR_SIGNAL_INVALID');
 },{timeout:7000,maxWait:2000});
 const limit=['queueDelay','requestLatency','jobLatency'].includes(signal)?1:config[signal];if(!Number.isInteger(limit)||count>=limit)process.exitCode=1;
}catch{process.exitCode=1;}finally{await db.$disconnect();}
