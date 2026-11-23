import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {verificationDatabases} from './verification/contracts.mjs';
import * as fixtureModule from '../tests/fixtures/database-domains.ts';
const {databaseDomainFixture}=fixtureModule.default??fixtureModule;
const {runtime,owner}=verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:owner.toString()}}});
const folder=await mkdtemp(path.join(tmpdir(),'dashboard-database-recovery-')),target='dashboard_restore_'+randomUUID().replaceAll('-','');
let created=false,fixture;
const baseEnv={...process.env,PGPASSWORD:decodeURIComponent(owner.password),PGCONNECT_TIMEOUT:'5'};
const connection=['--host',owner.hostname.replace(/^\[|\]$/g,''),'--port',owner.port||'5432','--username',decodeURIComponent(owner.username)];
const tool=name=>process.env.DASHBOARD_PG_BIN?path.join(process.env.DASHBOARD_PG_BIN,name):name;
function run(command,args,env=baseEnv){const r=spawnSync(command,args,{env,encoding:'utf8',maxBuffer:16*1024*1024});if(r.error||r.status!==0)throw Error('DATABASE_RECOVERY_COMMAND_FAILED');return r.stdout.trim();}
const node=(args,env=baseEnv)=>run(process.execPath,args,env);
try{
 const version=Number((await db.$queryRaw`SHOW server_version_num`)[0].server_version_num);
 if(version<170000||version>=180000)throw Error('DATABASE_RECOVERY_REQUIRES_POSTGRESQL_17');
 for(const name of ['pg_dump','pg_restore','createdb','dropdb'])if(!/\b17\./.test(run(tool(name),['--version'])))throw Error('DATABASE_RECOVERY_REQUIRES_POSTGRESQL_17_TOOLS');
 fixture=await db.$transaction(tx=>databaseDomainFixture(tx),{timeout:30000});
 const before=node(['--import','tsx','scripts/database-fingerprint.mjs']);
 run(tool('pg_dump'),[...connection,'--dbname','dashboard_test','--format=custom','--file',path.join(folder,'dashboard.dump')]);
 run(tool('createdb'),[...connection,target]);created=true;
 run(tool('pg_restore'),[...connection,'--dbname',target,'--no-owner','--no-privileges','--exit-on-error',path.join(folder,'dashboard.dump')]);
 const restoredOwner=new URL(owner);restoredOwner.pathname='/'+target;const restoredRuntime=new URL(runtime);restoredRuntime.pathname='/'+target;
 const env={...baseEnv,DASHBOARD_DATABASE_URL:restoredRuntime.toString(),DASHBOARD_MIGRATION_DATABASE_URL:restoredOwner.toString()};
 node(['--import','tsx','scripts/grant-database-access.mjs'],env);
 node(['--import','tsx','scripts/check-database.mjs'],env);
 const after=node(['--import','tsx','scripts/database-fingerprint.mjs'],env);
 if(before!==after)throw Error('DATABASE_RECOVERY_FINGERPRINT_MISMATCH');
 const fingerprint=JSON.parse(after),result={passed:true,tables:Object.keys(fingerprint).length,fixtureDomains:Object.keys(fixture.ids).length,restrictedRoleRestoreRead:true};
 const report=process.env.DASHBOARD_DATABASE_RECOVERY_REPORT;if(report)await writeFile(report,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}catch(error){console.error(error instanceof Error?error.message:'DATABASE_RECOVERY_FAILED');process.exitCode=1;}
finally{
 try{
  if(created)run(tool('dropdb'),[...connection,'--if-exists',target]);
  if(fixture){
   await db.dashboardObservationBucket.deleteMany({where:fixture.observationBucketKey});
   await db.dashboardWorkspace.delete({where:{id:fixture.workspace.id}});
   await db.dashboardOrganization.delete({where:{id:fixture.org.id}});
   await db.dashboardUser.delete({where:{id:fixture.user.id}});
   await db.dashboardBillingPlan.deleteMany({where:{id:fixture.ids.dashboardBillingPlan}});
   await db.dashboardConfiguration.deleteMany({where:{id:fixture.ids.dashboardConfiguration}});
  }
 }finally{await db.$disconnect();await rm(folder,{recursive:true,force:true});}
}
