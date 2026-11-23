import {mkdtemp,mkdir,writeFile,lstat,cp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sealRelease,within} from './artifact.mjs';
export async function buildRelease(output,version){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(version??''))throw Error('RELEASE_INVALID_VERSION');
 if(process.versions.node.split('.')[0]!=='22')throw Error('RELEASE_REQUIRES_NODE_22');
 const root=fileURLToPath(new URL('../../',import.meta.url)),destination=path.resolve(output);if(await realpath(path.dirname(destination))!==path.dirname(destination)||within(destination,root))throw Error('RELEASE_OUTPUT_MUST_BE_OUTSIDE_CHECKOUT');
 try{await lstat(destination);throw Error('RELEASE_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 function git(args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw Error('RELEASE_GIT_FAILED');return r.stdout;}
 const dirty=git(['status','--porcelain','--untracked-files=all']).split('\n').filter(line=>line&&line.trim()!=='D node_modules');if(dirty.length)throw Error('RELEASE_REQUIRES_COMMITTED_SOURCE');
 const revision=git(['rev-parse','HEAD']).trim(),stage=await mkdtemp(path.join(tmpdir(),'dashboard-release-build-'));
 // Never read .env files or inherit application/owner credentials into a build.
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','TMPDIR','SYSTEMROOT','NODE_EXTRA_CA_CERTS'].includes(k)||/^(?:https?|all|no)_proxy$/i.test(k)||/^(?:NPM_CONFIG_(?:HTTPS?_PROXY|PROXY|CAFILE))$/i.test(k)));
 Object.assign(env,{PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??''),NPM_CONFIG_USERCONFIG:'/dev/null',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',CHECKPOINT_DISABLE:'1',DASHBOARD_DATABASE_URL:'postgresql://dashboard_build:build-only@127.0.0.1:9/dashboard_build?schema=public',DASHBOARD_RELEASE_MODE:'OFF',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_BILLING_ENABLED:'false',DASHBOARD_BILLING_SELF_SERVICE_ENABLED:'false',DASHBOARD_DATA_CONNECTORS_ENABLED:'false',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false'});
 try{
  const paths=git(['ls-tree','-r','--name-only','HEAD']).trim().split('\n').filter(p=>/^(?:src\/|scripts\/|tests\/|prisma\/|contracts\/|public\/|package(?:-lock)?\.json$|next\.config\.ts$|tsconfig\.json$|next-env\.d\.ts$)/.test(p));
  for(const p of paths){const r=spawnSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:32*1024*1024});if(r.status!==0)throw Error('RELEASE_SOURCE_READ_FAILED');await mkdir(path.dirname(path.join(stage,p)),{recursive:true});await writeFile(path.join(stage,p),r.stdout);}
  for(const [command,args] of [['npm',['ci','--include=dev','--no-audit','--no-fund']],[process.execPath,['scripts/security/audit.mjs']],[process.execPath,['scripts/check-isolation.mjs']],[process.execPath,['node_modules/prisma/build/index.js','generate','--schema','prisma/schema.prisma']],[process.execPath,['node_modules/next/dist/bin/next','build']]]){
   const r=spawnSync(command,args,{cwd:stage,env,stdio:'inherit'});if(r.error||r.status!==0)throw Error('RELEASE_BUILD_FAILED');
  }
  await rm(path.join(stage,'.next','cache'),{recursive:true,force:true});
  const sealed=await sealRelease(stage,{version,revision});await cp(stage,destination,{recursive:true,dereference:false,verbatimSymlinks:true});return sealed;
 }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){buildRelease(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify({digest:r.digest,version:r.manifest.version,revision:r.manifest.revision}))).catch(()=>{console.error('RELEASE_BUILD_FAILED');process.exitCode=1;});}
