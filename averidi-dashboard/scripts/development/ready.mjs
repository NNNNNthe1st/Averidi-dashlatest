import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {developmentRuntime,readDevelopmentSettings,cleanDevelopmentEnvironment} from './environment.mjs';

export function developmentFailureCategory(error){
 const code=error?.code??error?.errorCode,sql=error?.meta?.code,message=String(error?.message??'');
 if(['P1001','P1002','P1017'].includes(code)||/Can't reach database server|Connection refused|ECONNREFUSED|connection.*closed/i.test(message))return 'DATABASE_UNAVAILABLE';
 if(code==='P1000'||/authentication failed/i.test(message))return 'DATABASE_CREDENTIALS_REJECTED';
 if(['P2021','P2022'].includes(code)||['42P01','42703'].includes(sql))return 'DATABASE_SCHEMA_NOT_CURRENT';
 if(sql==='42501')return 'DATABASE_PERMISSIONS_MISSING';
 return 'DATABASE_CHECK_FAILED';
}
export async function probeDevelopmentDatabase(root,env){
 const {PrismaClient,Prisma}=createRequire(path.join(root,'package.json'))('@prisma/client');
 const url=new URL(env.DASHBOARD_DATABASE_URL);url.searchParams.set('connect_timeout','3');url.searchParams.set('pool_timeout','5');
 const db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
 try{
  const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS name,current_user AS role');
  if(identity.name!=='dashboard_dev'||identity.role!=='dashboard_development_runtime')return {ok:false,category:'DATABASE_IDENTITY_MISMATCH'};
  const columns=await db.$queryRawUnsafe("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
  for(const model of Prisma.dmmf.datamodel.models)for(const field of model.fields.filter(f=>f.kind!=='object')){
   if(!columns.some(c=>c.table_name===(model.dbName??model.name)&&c.column_name===(field.dbName??field.name)))return {ok:false,category:'DATABASE_SCHEMA_NOT_CURRENT'};
  }
  const [permissions]=await db.$queryRawUnsafe("SELECT bool_and(has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'SELECT') AND has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'INSERT') AND has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'UPDATE') AND has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'DELETE')) AS allowed FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Dashboard%'");
  if(permissions.allowed!==true)return {ok:false,category:'DATABASE_PERMISSIONS_MISSING'};
  return {ok:true};
 }catch(error){return {ok:false,category:developmentFailureCategory(error)};}
 finally{await db.$disconnect().catch(()=>{});}
}
async function setupDevelopment(root,source){
 // Recover only a workspace already provisioned by the Docker development setup.
 // A native PostgreSQL workspace must retain its explicitly chosen setup mode.
 for(const name of ['compose.env','provisioning.json']){
  let info;try{info=await lstat(path.join(root,'.local/development',name));}catch{throw Error('Automatic database recovery requires existing Docker development settings. Run your original npm run dev:setup mode.');}
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Development provisioning settings must be private regular files.');
 }
 const child=spawn(process.execPath,['scripts/setup-development.mjs'],{cwd:root,env:cleanDevelopmentEnvironment(source),stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 if(code!==0)throw Error('Development database setup failed. See the setup output above.');
}
export async function readyDevelopmentRuntime(root,{probe=probeDevelopmentDatabase,setup=setupDevelopment,read=readDevelopmentSettings,source=process.env,log=console.log}={}){
 let env=developmentRuntime(await read(root),root,source);
 let result=await probe(root,env);
 if(result.ok){log('Development database schema and runtime permissions are ready.');return env;}
 const repairable=['DATABASE_UNAVAILABLE','DATABASE_SCHEMA_NOT_CURRENT','DATABASE_PERMISSIONS_MISSING','DATABASE_CREDENTIALS_REJECTED'];
 if(!repairable.includes(result.category))throw Error('Development database preflight failed: '+result.category+'. Web and worker were not started.');
 log('Development database preflight: '+result.category+'. Running the existing persistent development setup.');
 await setup(root,source);
 // Setup can change the published database port. Never reuse the old runtime URL.
 env=developmentRuntime(await read(root),root,source);
 result=await probe(root,env);
 if(!result.ok)throw Error('Development database is still not ready: '+result.category+'. Web and worker were not started.');
 log('Development database recovered; schema and runtime permissions are ready.');
 return env;
}

