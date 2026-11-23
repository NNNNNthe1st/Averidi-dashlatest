import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=process.cwd();
let db,stage='private-runtime-settings';
const safe=(v)=>typeof v==='string'&&/^[A-Za-z0-9_."-]{1,150}$/.test(v)?v:undefined;
try{
 const {developmentRuntime,readDevelopmentSettings}=await import(pathToFileURL(path.join(root,'scripts/development/environment.mjs')).href);
 const env=developmentRuntime(await readDevelopmentSettings(root),root);
 const require=createRequire(path.join(root,'package.json'));
 const {PrismaClient}=require('@prisma/client');
 db=new PrismaClient({datasources:{db:{url:env.DASHBOARD_DATABASE_URL}},log:[]});
 const probe=async(name,run)=>{stage=name;await run();console.log(JSON.stringify({check:name,status:'ok'}));};
 // Fixed SQL only. No user values or credentials are interpolated into queries.
 await probe('database-connection',()=>db.$queryRawUnsafe('SELECT 1'));
 await probe('source-monitoring-read',()=>db.$queryRawUnsafe('SELECT id,"workspaceId" FROM "DashboardDataSource" LIMIT 0'));
 await probe('worker-heartbeat-schema',()=>db.$queryRawUnsafe('SELECT id,"activeJobId",stopping,capabilities,version,"seenAt" FROM "DashboardWorkerHeartbeat" LIMIT 0'));
 await probe('worker-table-permissions',async()=>{
  const [row]=await db.$queryRawUnsafe("SELECT has_table_privilege(current_user,'\"DashboardWorkerHeartbeat\"','SELECT') AND has_table_privilege(current_user,'\"DashboardWorkerHeartbeat\"','INSERT') AND has_table_privilege(current_user,'\"DashboardWorkerHeartbeat\"','UPDATE') AS allowed");
  if(!row.allowed){const e=Error();e.code='WORKER_PERMISSIONS_MISSING';throw e;}
 });
 await probe('account-schema',()=>db.$queryRawUnsafe('SELECT id,email,"passwordHash","emailVerifiedAt" FROM "DashboardUser" LIMIT 0'));
 await probe('account-token-schema',()=>db.$queryRawUnsafe('SELECT id,"userId",kind,"tokenHash","expiresAt","consumedAt" FROM "DashboardCredentialToken" LIMIT 0'));
 await probe('workspace-trial-schema',()=>db.$queryRawUnsafe('SELECT id,"trialStartedAt" FROM "DashboardWorkspace" LIMIT 0'));
 await probe('migration-history',async()=>{
  const applied=await db.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"');
  const dirs=(await readdir(path.join(root,'prisma/migrations'),{withFileTypes:true})).filter(d=>d.isDirectory());
  const missing=[];
  for(const dir of dirs){const hash=createHash('sha256').update(await readFile(path.join(root,'prisma/migrations',dir.name,'migration.sql'))).digest('hex');if(!applied.some(m=>m.migration_name===dir.name&&m.checksum===hash&&m.finished_at&&!m.rolled_back_at))missing.push(dir.name);}
  if(missing.length){console.log(JSON.stringify({missingMigrations:missing.map(safe).filter(Boolean)}));const e=Error();e.code='MIGRATIONS_NOT_CURRENT';throw e;}
 });
 console.log('Development database checks passed. No records or credentials were printed or changed.');
}catch(error){
 console.error(JSON.stringify({check:stage,status:'failed',code:safe(error.code??error.errorCode)??'UNCLASSIFIED',sqlState:safe(error.meta?.code),model:safe(error.meta?.modelName),table:safe(error.meta?.table),column:safe(error.meta?.column)}));
 process.exitCode=1;
}finally{if(db)await db.$disconnect().catch(()=>{});}
