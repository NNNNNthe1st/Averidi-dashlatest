import {PrismaClient} from '@prisma/client';
import {mkdtemp,cp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as boundaryModule from '../src/server/data-boundary.ts';
const {requireDashboardDatabaseUrl}=boundaryModule.default??boundaryModule;
const url=new URL(requireDashboardDatabaseUrl(process.env.DASHBOARD_MIGRATION_DATABASE_URL??process.env.DASHBOARD_DATABASE_URL));
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Upgrade acceptance requires a loopback development database.');
const schema='dashboard_upgrade_'+randomUUID().replaceAll('-','');
url.searchParams.set('schema',schema);
const env={...process.env,CHECKPOINT_DISABLE:'1',DASHBOARD_DATABASE_URL:url.toString(),DASHBOARD_MIGRATION_DATABASE_URL:url.toString()};
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const root=await mkdtemp(path.join(tmpdir(),'dashboard-upgrade-'));
function run(args){const r=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('Database upgrade acceptance command failed.');}
try{
 await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
 await writeFile(path.join(root,'schema.prisma'),await readFile('prisma/schema.prisma'));
 const legacy=path.join(root,'migrations');
 for(const e of await readdir('prisma/migrations',{withFileTypes:true})){
  if(e.isDirectory()&&e.name>='20261022200000_complete_database_domains')continue;
  await cp(path.join('prisma/migrations',e.name),path.join(legacy,e.name),{recursive:true});
 }
 run(['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(root,'schema.prisma')]);
 // Use raw inserts because the current generated client deliberately knows the new fields.
 await db.$executeRaw`INSERT INTO "DashboardWorkspace" (id,name) VALUES ('upgrade_workspace','Preserved workspace')`;
 await db.$executeRaw`INSERT INTO "DashboardDataSource" (id,"workspaceId",kind,name,status,"updatedAt") VALUES ('upgrade_source','upgrade_workspace','FILE','Preserved source','CONNECTED',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO "DashboardDataset" (id,"workspaceId",name,status,"sourceId","updatedAt") VALUES ('upgrade_dataset','upgrade_workspace','Preserved dataset','READY','upgrade_source',CURRENT_TIMESTAMP)`;
 await db.$executeRaw`INSERT INTO "DashboardDatasetVersion" (id,"datasetId",version,status,"storageKey","fileSize",checksum,profile) VALUES ('upgrade_version','upgrade_dataset',1,'READY','uploads/upgrade_workspace/preserved',10,'preserved-checksum','{"fields":{"amount":{"type":"number"}}}'::jsonb)`;
 await db.$executeRaw`UPDATE "DashboardDataset" SET "activeVersionId"='upgrade_version' WHERE id='upgrade_dataset'`;
 run(['--import','tsx','scripts/migrate-database.mjs']);
 const dataset=await db.dashboardDataset.findUniqueOrThrow({where:{id:'upgrade_dataset'},include:{activeVersion:true,source:true}});
 if(dataset.name!=='Preserved dataset'||dataset.source?.id!=='upgrade_source'||dataset.activeVersion?.checksum!=='preserved-checksum'||dataset.activeVersion?.fileSize!==BigInt(10)||JSON.stringify(dataset.activeVersion?.profile)!==JSON.stringify({fields:{amount:{type:'number'}}}))throw Error('Existing Dashboard data changed during upgrade.');
 const [capacity]=await db.$queryRaw`SELECT dashboard_quota_usage('upgrade_workspace') AS usage`;
 if(capacity.usage.datasets!=='1'||capacity.usage.storedBytes!=='10')throw Error('Quota functions escaped the isolated upgrade schema.');
 const plan=await db.dashboardBillingPlan.create({data:{code:'UPGRADE_QUOTA',name:'Upgrade quota fixture',active:true,entitlements:{dashboardAccess:true,quotas:{datasets:1}}}});
 await db.dashboardSubscription.create({data:{workspaceId:'upgrade_workspace',billingPlanId:plan.id,planCode:plan.code,status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}});
 let quotaRejected=false;try{await db.dashboardDataset.create({data:{workspaceId:'upgrade_workspace',name:'Must be refused'}});}catch(error){quotaRejected=String(error).includes('DASHBOARD_QUOTA_EXCEEDED:datasets');}
 if(!quotaRejected)throw Error('Upgraded quota admission did not enforce the preserved dataset capacity.');
 run(['--import','tsx','scripts/check-database.mjs']);
 run(['node_modules/prisma/build/index.js','migrate','diff','--from-url',url.toString(),'--to-schema-datamodel','prisma/schema.prisma','--exit-code']);
 console.log('Dashboard prior migration chain upgraded without data loss or schema drift.');
}finally{
 try{await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await db.$disconnect();await rm(root,{recursive:true,force:true});}
}
