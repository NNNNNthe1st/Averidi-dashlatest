import {erasureSettings} from '../account-erasure/contracts';
import {readErasureDecisions} from '../account-erasure/ledger';
import {reconcileErasureLedger} from '../account-erasure/reconcile';
import {constants} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,lstat,realpath,readFile,open,readdir} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {dashboardDb} from '../../server/db';
import {dashboardStorageRoot} from '../../server/storage';
import {validDashboardObjectKey} from '../../server/object-storage';
import {dashboardStorageBackend,type StorageBackend} from './inventory';
import {storageReferences} from './lifecycle';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const key=(encoded:string)=>{if(!/^[a-fA-F0-9]{64}$/.test(encoded))throw Error('STORAGE_BACKUP_KEY_REQUIRED');return Buffer.from(encoded,'hex');};
function seal(bytes:Buffer,secret:Buffer,aad:string){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(Buffer.from(aad));const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([Buffer.from('DSB1'),nonce,cipher.getAuthTag(),encrypted]);}
function unseal(bytes:Buffer,secret:Buffer,aad:string){if(bytes.length<32||bytes.subarray(0,4).toString()!=='DSB1')throw Error('STORAGE_BACKUP_CORRUPT');const decipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(4,16));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(bytes.subarray(16,32));try{return Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]);}catch{throw Error('STORAGE_BACKUP_CORRUPT');}}
const manifestSchema=z.object({version:z.literal(1),workspaceId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),createdAt:z.string().datetime(),objects:z.array(z.object({key:z.string().max(512),checksum:z.string().regex(/^[a-f0-9]{64}$/),size:z.string().regex(/^\d+$/)}).strict()).max(100000),references:z.array(z.object({kind:z.enum(['VERSION','SNAPSHOT','REPORT']),id:z.string(),workspaceId:z.string(),key:z.string(),checksum:z.string(),size:z.string()}).strict()).max(200000)}).strict();
async function privateDirectory(folder:string,create=false){const absolute=path.resolve(folder),ledger=erasureSettings()?.root;if(ledger&&(absolute===ledger||absolute.startsWith(ledger+path.sep)||ledger.startsWith(absolute+path.sep)))throw Error('STORAGE_BACKUP_PATH_INVALID');if(create)await mkdir(absolute,{recursive:true,mode:0o700});if(await realpath(absolute)!==absolute)throw Error('STORAGE_BACKUP_PATH_INVALID');const stat=await lstat(absolute);if(!stat.isDirectory()||(stat.mode&0o077))throw Error('STORAGE_BACKUP_PATH_INVALID');if(process.env.DASHBOARD_STORAGE_BACKEND!=='object'){const root=dashboardStorageRoot();if(absolute===root||absolute.startsWith(root+path.sep)||root.startsWith(absolute+path.sep))throw Error('STORAGE_BACKUP_PATH_INVALID');}return absolute;}
async function writePrivate(file:string,bytes:Buffer){const handle=await open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
async function readPrivate(file:string,max:number){const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size>max)throw Error('STORAGE_BACKUP_PATH_INVALID');const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const current=await handle.stat();if(current.ino!==stat.ino||current.dev!==stat.dev)throw Error('STORAGE_BACKUP_PATH_INVALID');return await handle.readFile();}finally{await handle.close();}}
async function withMaintenance<T>(apply:(renew:()=>Promise<void>)=>Promise<T>){
 const token=randomUUID();
 await dashboardDb.$transaction(async tx=>{
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('dashboard-storage-maintenance',0))`;
  if(await tx.dashboardStorageMaintenance.count({where:{id:'storage',expiresAt:{gt:new Date()}}}))throw Error('STORAGE_MAINTENANCE');
  if(await tx.dashboardJob.count({where:{status:'RUNNING'}})||await tx.dashboardStorageDeletion.count({where:{status:'DELETING'}})||await tx.dashboardReportExport.count({where:{status:'CLEANUP_PENDING'}}))throw Error('STORAGE_BUSY');
  await tx.dashboardStorageMaintenance.upsert({where:{id:'storage'},create:{id:'storage',ownerToken:token,expiresAt:new Date(Date.now()+300000)},update:{ownerToken:token,expiresAt:new Date(Date.now()+300000),startedAt:new Date()}});
 });
 const renew=async()=>{const changed=await dashboardDb.dashboardStorageMaintenance.updateMany({where:{id:'storage',ownerToken:token,expiresAt:{gt:new Date()}},data:{expiresAt:new Date(Date.now()+300000)}});if(!changed.count)throw Error('STORAGE_MAINTENANCE_LOST');};
 try{return await apply(renew);}finally{await dashboardDb.dashboardStorageMaintenance.deleteMany({where:{id:'storage',ownerToken:token}});}
}
export async function createStorageBackup(folder:string,secretHex:string,workspaceId?:string,backend:StorageBackend=dashboardStorageBackend()){
 const secret=key(secretHex);const directory=await privateDirectory(folder,true);if((await readdir(directory)).length)throw Error('STORAGE_BACKUP_NOT_EMPTY');
 return withMaintenance(async renew=>{
  const references=await dashboardDb.$transaction(tx=>storageReferences(tx,workspaceId));const objects=await backend.list(workspaceId);const entries:{key:string;checksum:string;size:string}[]=[];let total=BigInt(0);
  for(const object of objects.filter(o=>!o.partial)){
   await renew();if(!validDashboardObjectKey(object.key)||workspaceId&&object.key.split('/')[1]!==workspaceId)throw Error('INVALID_STORAGE_SCOPE');if(object.size>BigInt(50)*BigInt(1024)*BigInt(1024))throw Error('STORAGE_BACKUP_LIMIT');
   total+=object.size;if(total>BigInt(50)*BigInt(1024)*BigInt(1024)*BigInt(1024))throw Error('STORAGE_BACKUP_LIMIT');
   const bytes=await backend.read(object.key);if(BigInt(bytes.length)!==object.size)throw Error('STORAGE_OBJECT_CHANGED');const checksum=hash(bytes);
   if((await backend.stat(object.key))?.fingerprint!==object.fingerprint)throw Error('STORAGE_OBJECT_CHANGED');
   const file=hash(Buffer.from(object.key))+'.enc';await writePrivate(path.join(directory,file),seal(bytes,secret,'dashboard-storage-object:'+object.key));entries.push({key:object.key,checksum,size:String(bytes.length)});
  }
  for(const ref of references){const object=entries.find(o=>o.key===ref.key);if(!object||object.checksum!==ref.checksum||object.size!==ref.size)throw Error('STORAGE_REFERENCE_INTEGRITY_FAILURE');}
  await renew();const current=await dashboardDb.$transaction(tx=>storageReferences(tx,workspaceId));if(!isDeepStrictEqual(current,references))throw Error('STORAGE_REFERENCE_CHANGED');
  const manifest=manifestSchema.parse({version:1,workspaceId:workspaceId??null,createdAt:new Date().toISOString(),objects:entries,references});
  const manifestBytes=Buffer.from(JSON.stringify(manifest));if(manifestBytes.length>32*1024*1024)throw Error('STORAGE_BACKUP_LIMIT');
  await writePrivate(path.join(directory,'manifest.enc'),seal(manifestBytes,secret,'dashboard-storage-manifest-v1'));
  return {objects:entries.length,references:references.length,bytes:String(total)};
 });
}
export async function restoreStorageBackup(folder:string,secretHex:string,backend:StorageBackend=dashboardStorageBackend()){
 if(erasureSettings()){if((process.env.DASHBOARD_RELEASE_MODE??'OFF')!=='OFF')throw Error('ERASURE_RECONCILIATION_REQUIRES_RELEASE_OFF');await readErasureDecisions();}
 const secret=key(secretHex),directory=await privateDirectory(folder);const raw=unseal(await readPrivate(path.join(directory,'manifest.enc'),32*1024*1024+32),secret,'dashboard-storage-manifest-v1');
 const parsed=manifestSchema.safeParse(JSON.parse(raw.toString()));if(!parsed.success)throw Error('STORAGE_BACKUP_CORRUPT');const manifest=parsed.data;
 if(manifest.objects.reduce((sum,o)=>sum+BigInt(o.size),BigInt(0))>BigInt(50)*BigInt(1024)*BigInt(1024)*BigInt(1024))throw Error('STORAGE_BACKUP_LIMIT');
 const keys=new Set(manifest.objects.map(o=>o.key));if(keys.size!==manifest.objects.length||manifest.objects.some(o=>!validDashboardObjectKey(o.key)||BigInt(o.size)>BigInt(50)*BigInt(1024)*BigInt(1024)||manifest.workspaceId&&o.key.split('/')[1]!==manifest.workspaceId))throw Error('STORAGE_BACKUP_CORRUPT');
 const load=async(object:typeof manifest.objects[number])=>{const bytes=unseal(await readPrivate(path.join(directory,hash(Buffer.from(object.key))+'.enc'),50*1024*1024+32),secret,'dashboard-storage-object:'+object.key);if(String(bytes.length)!==object.size||hash(bytes)!==object.checksum)throw Error('STORAGE_BACKUP_CORRUPT');return bytes;};
 const result=await withMaintenance(async renew=>{
  const references=await dashboardDb.$transaction(tx=>storageReferences(tx,manifest.workspaceId??undefined));if(!isDeepStrictEqual(references,manifest.references))throw Error('STORAGE_REFERENCE_CHANGED');
  const existing=await backend.list(manifest.workspaceId??undefined);if(existing.some(o=>o.partial||!keys.has(o.key)))throw Error('STORAGE_RESTORE_TARGET_NOT_EMPTY');
  // Preflight every encrypted object and existing destination before writing anything.
  for(const object of manifest.objects){await renew();await load(object);const current=await backend.stat(object.key);if(current){const bytes=await backend.read(object.key);if(String(bytes.length)!==object.size||hash(bytes)!==object.checksum)throw Error('STORAGE_RESTORE_CONFLICT');}}
  let restored=0;
  for(const object of manifest.objects){await renew();const bytes=await load(object);if(!await backend.stat(object.key))await backend.write(object.key,bytes);const verified=await backend.read(object.key);if(hash(verified)!==object.checksum||String(verified.length)!==object.size)throw Error('STORAGE_RESTORE_INTEGRITY_FAILURE');restored++;}
  await renew();return {restored,references:references.length};
 });
 if(erasureSettings())return {...result,erasureReconciliation:await reconcileErasureLedger()};
 return result;
}
