import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {readdir,readFile,writeFile,lstat,readlink,realpath,cp,mkdir,rename,rm,open} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
export const digestPattern=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const entry=z.discriminatedUnion('type',[
 z.object({path:z.string(),type:z.literal('file'),size:z.number().int().nonnegative(),mode:z.number().int(),sha256:z.string().regex(digestPattern)}).strict(),
 z.object({path:z.string(),type:z.literal('link'),target:z.string()}).strict(),
]);
const schema=z.object({product:z.literal('averidi-dashboard'),format:z.literal(1),version:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),revision:z.string().regex(/^[a-f0-9]{40}$/),node:z.literal(22),platform:z.string(),arch:z.string(),createdAt:z.string().datetime(),files:z.array(entry).min(1),migrations:z.array(z.object({name:z.string(),sha256:z.string().regex(digestPattern)}).strict())}).strict();
export function within(child,parent){return child===parent||child.startsWith(parent+path.sep);}
const ignored=p=>p==='release.json'||p==='.next/cache'||p.startsWith('.next/cache/');
async function fileHash(file){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
export async function inventory(folder){
 const root=await realpath(folder),files=[];
 async function walk(relative=''){
  for(const name of (await readdir(path.join(root,relative))).sort()){
   const p=relative?relative+'/'+name:name;if(ignored(p)){if(p==='.next/cache'){const s=await lstat(path.join(root,p));if(!s.isDirectory()||s.isSymbolicLink())throw Error('RELEASE_CACHE_REJECTED');}continue;}
   if(p.split('/').some(segment=>segment==='.git'||/^\.env(?:\.|$)/.test(segment)))throw Error('RELEASE_SECRET_OR_GIT_FILE');
   const absolute=path.join(root,p),s=await lstat(absolute);
   if(s.isSymbolicLink()){
    const target=await readlink(absolute);if(path.isAbsolute(target)||!within(path.resolve(path.dirname(absolute),target),root)||!within(await realpath(absolute),root))throw Error('RELEASE_LINK_ESCAPE');
    files.push({path:p,type:'link',target});
   }else if(s.isDirectory())await walk(p);
   else if(s.isFile())files.push({path:p,type:'file',size:s.size,mode:s.mode&0o777,sha256:await fileHash(absolute)});
   else throw Error('RELEASE_SPECIAL_FILE');
  }
 }
 await walk();return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function sealRelease(folder,{version,revision}){
 const files=await inventory(folder),migrations=files.filter(f=>f.type==='file'&&/^prisma\/migrations\/[^/]+\/migration.sql$/.test(f.path)).map(f=>({name:f.path.split('/')[2],sha256:f.sha256}));
 const manifest=schema.parse({product:'averidi-dashboard',format:1,version,revision,node:22,platform:process.platform,arch:process.arch,createdAt:new Date().toISOString(),files,migrations});
 await writeFile(path.join(folder,'release.json'),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});return verifyRelease(folder);
}
export async function verifyRelease(folder,expected){
 if((await lstat(folder)).isSymbolicLink())throw Error('RELEASE_SYMLINK_ROOT');
 const manifestStat=await lstat(path.join(folder,'release.json'));if(!manifestStat.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>32*1024*1024)throw Error('RELEASE_MANIFEST_REJECTED');
 const raw=await readFile(path.join(folder,'release.json'));
 const digest=hash(raw),manifest=schema.parse(JSON.parse(raw));
 if(expected!==undefined&&(!digestPattern.test(expected)||digest!==expected))throw Error('RELEASE_DIGEST_MISMATCH');
 if(manifest.platform!==process.platform||manifest.arch!==process.arch||Number(process.versions.node.split('.')[0])!==manifest.node)throw Error('RELEASE_PLATFORM_MISMATCH');
 const files=await inventory(folder);if(JSON.stringify(files)!==JSON.stringify(manifest.files))throw Error('RELEASE_INTEGRITY_FAILURE');
 for(const p of ['package.json','package-lock.json','next.config.ts','.next/BUILD_ID','node_modules/next/dist/bin/next','scripts/releases/worker.mjs','scripts/check-database.mjs','scripts/check-storage.mjs','prisma/schema.prisma'])if(!files.some(f=>f.path===p&&f.type==='file'))throw Error('RELEASE_INCOMPLETE');
 if(JSON.parse(await readFile(path.join(folder,'package.json'),'utf8')).name!=='averidi-dashboard')throw Error('FOREIGN_RELEASE');
 const migrations=files.filter(f=>f.type==='file'&&/^prisma\/migrations\/[^/]+\/migration.sql$/.test(f.path)).map(f=>({name:f.path.split('/')[2],sha256:f.sha256}));
 if(!migrations.length||JSON.stringify(migrations)!==JSON.stringify(manifest.migrations))throw Error('RELEASE_MIGRATION_MISMATCH');
 return {digest,manifest,migrationDigest:hash(JSON.stringify(migrations))};
}
export async function privateDirectory(folder){
 const absolute=path.resolve(folder);await mkdir(absolute,{recursive:true,mode:0o700});const s=await lstat(absolute);
 if(!s.isDirectory()||s.isSymbolicLink()||await realpath(absolute)!==absolute||(s.mode&0o077)||s.uid!==process.getuid())throw Error('RELEASE_PRIVATE_DIRECTORY_REQUIRED');return absolute;
}
export async function initializeHost(folder){
 const root=await privateDirectory(folder);const marker=path.join(root,'host.json');
 try{const value=JSON.parse(await readFile(marker,'utf8'));if(value.product!=='averidi-dashboard'||value.format!==1)throw Error('FOREIGN_RELEASE_HOST');}catch(e){if(e.code!=='ENOENT')throw e;if((await readdir(root)).length)throw Error('FOREIGN_RELEASE_HOST');await writeFile(marker,JSON.stringify({product:'averidi-dashboard',format:1})+'\n',{flag:'wx',mode:0o600});}
 await privateDirectory(path.join(root,'releases'));return root;
}
export async function hostRoot(folder){
 const root=await privateDirectory(folder),marker=JSON.parse(await readFile(path.join(root,'host.json'),'utf8'));if(marker.product!=='averidi-dashboard'||marker.format!==1)throw Error('FOREIGN_RELEASE_HOST');await privateDirectory(path.join(root,'releases'));return root;
}
export async function installRelease(root,source,expected){
 root=await hostRoot(root);const original=await verifyRelease(source,expected),target=path.join(root,'releases',original.digest);
 try{await lstat(target);await verifyRelease(target,expected);return original;}catch(e){if(e.code!=='ENOENT')throw e;}
 const stage=path.join(root,'releases','staging-'+randomUUID());
 try{await cp(source,stage,{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE,filter:p=>{const relative=path.relative(source,p).split(path.sep).join('/');return relative!=='.next/cache'&&!relative.startsWith('.next/cache/');}});await verifyRelease(stage,expected);try{await rename(stage,target);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;await verifyRelease(target,expected);}return original;}finally{await rm(stage,{recursive:true,force:true});}
}
export async function atomicJson(file,value){
 const temporary=file+'.'+randomUUID();let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();await handle.close();handle=null;await rename(temporary,file);const directory=await open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
 finally{if(handle)await handle.close();await rm(temporary,{force:true});}
}
