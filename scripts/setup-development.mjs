import {randomBytes} from 'node:crypto';
import {readFile,writeFile,lstat,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {privateDirectory,privateJson,cleanDevelopmentEnvironment,developmentRuntime,developmentOwner} from './development/environment.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const folder=path.join(root,'.local/development');
const env=cleanDevelopmentEnvironment();
const compose=['compose','--project-name','averidi-dashboard-development','--env-file',path.join(folder,'compose.env'),'-f','compose.yaml'];
function run(command,args,environment=env,capture=false){
 const result=spawnSync(command,args,{cwd:root,env:environment,encoding:'utf8',stdio:capture?'pipe':'inherit',timeout:300000});
 if(result.error||result.status!==0)throw Error('Development setup command failed: '+command+' '+args[0]);
 return result.stdout?.trim();
}
try{
 if(process.versions.node.split('.')[0]!=='22')throw Error('Development requires Node 22.');
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>arg!=='--existing-development-database'))throw Error('Usage: npm run dev:setup [-- --existing-development-database]');
 const native=args.includes('--existing-development-database');
 const nativeOwner=native?developmentOwner(process.env.DASHBOARD_MIGRATION_DATABASE_URL):null;
 if(!native)run('docker',['compose','version'],env,true);
 await privateDirectory(path.join(root,'.local'));await privateDirectory(folder);await privateDirectory(path.join(folder,'storage'));
 const filename=path.join(folder,'provisioning.json');let state;
 try{const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Unsafe development provisioning file.');state=JSON.parse(await readFile(filename,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;state={ownerPassword:randomBytes(32).toString('hex'),runtimePassword:randomBytes(32).toString('hex'),sessionSecret:randomBytes(48).toString('hex'),connectorKey:randomBytes(32).toString('hex')};await privateJson(filename,state,{create:true});}
 for(const key of ['ownerPassword','runtimePassword','connectorKey'])if(!/^[a-f0-9]{64}$/.test(state[key]))throw Error('Invalid persisted development provisioning state.');
 if(!/^[a-f0-9]{96}$/.test(state.sessionSecret))throw Error('Invalid persisted session secret.');
 let owner=nativeOwner?.toString();
 if(!native){
 const composeFile=path.join(folder,'compose.env');
 try{const info=await lstat(composeFile);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe Compose configuration.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(composeFile,`DASHBOARD_DEV_DB_PASSWORD=${state.ownerPassword}\nDASHBOARD_DEV_DB_PORT=0\n`,{mode:0o600});await chmod(composeFile,0o600);
 run('docker',[...compose,'up','-d','--wait','dashboard-postgres']);
 const address=run('docker',[...compose,'port','dashboard-postgres','5432'],env,true);
 const match=/^127\.0\.0\.1:(\d+)$/.exec(address);if(!match)throw Error('Development database must publish only a loopback port.');
 owner=`postgresql://dashboard:${state.ownerPassword}@127.0.0.1:${match[1]}/dashboard_dev?schema=public`;
 }
 const target=developmentOwner(owner);
 const probe=new PrismaClient({datasources:{db:{url:owner}}});
 try{const version=Number((await probe.$queryRaw`SHOW server_version_num`)[0].server_version_num);if(version<170000||version>=180000)throw Error('Development requires PostgreSQL 17.');}finally{await probe.$disconnect();}
 const settings={databaseUrl:`postgresql://dashboard_development_runtime:${state.runtimePassword}@127.0.0.1:${target.port}/dashboard_dev?schema=public`,sessionSecret:state.sessionSecret,connectorKey:state.connectorKey};
 const runtime=developmentRuntime(settings,root,env),migration={...runtime,DASHBOARD_MIGRATION_DATABASE_URL:owner};
 run(process.execPath,['--import','tsx','scripts/migrate-database.mjs'],migration);
 run(process.execPath,['node_modules/prisma/build/index.js','generate','--schema','prisma/schema.prisma'],runtime);
 const db=new PrismaClient({datasources:{db:{url:owner}}});
 try{
  const roles=await db.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='dashboard_development_runtime'`;
  const memberships=await db.$queryRaw`SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='dashboard_development_runtime')`;
  if(memberships.length||roles.some(row=>Object.values(row).some(Boolean)))throw Error('Existing development runtime role is elevated.');
  if(!roles.length)await db.$executeRawUnsafe(`CREATE ROLE dashboard_development_runtime LOGIN PASSWORD '${state.runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
 }finally{await db.$disconnect();}
 run(process.execPath,['--import','tsx','scripts/grant-database-access.mjs'],migration);
 run(process.execPath,['--import','tsx','scripts/check-database.mjs'],runtime);
 run(process.execPath,['--import','tsx','scripts/check-storage.mjs'],{...runtime,DASHBOARD_STORAGE_WRITE_CHECK:'true'});
 await privateJson(path.join(folder,'runtime.json'),settings);
 console.log('Dedicated persistent development database, restricted role and private storage are ready. Secrets were not printed.');
 console.log('Run npm run dev:serve. Development identity is optional; see docs/development-environment.md.');
}catch(error){console.error(error.message);process.exitCode=1;}
