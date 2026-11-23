import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
export function verificationDatabases(runtimeValue,ownerValue){
 const parse=value=>{let url;try{url=new URL(value);}catch{throw Error('VERIFICATION_DATABASE_REQUIRED');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||decodeURIComponent(url.pathname)!=='/dashboard_test'||!url.username||!url.password||url.hash||[...url.searchParams].some(([key,value])=>key!=='schema'||value!=='public')||url.searchParams.getAll('schema').length>1)throw Error('VERIFICATION_REQUIRES_ISOLATED_LOOPBACK_DATABASE');return url;};
 const runtime=parse(runtimeValue),owner=parse(ownerValue);
 if(runtime.hostname!==owner.hostname||(runtime.port||'5432')!==(owner.port||'5432')||runtime.pathname!==owner.pathname||runtime.username===owner.username||!/^dashboard_[a-z0-9_]*runtime$/.test(decodeURIComponent(runtime.username)))throw Error('VERIFICATION_REQUIRES_DISTINCT_RUNTIME_ROLE');
 return {runtime,owner};
}
export function parsePassingTap(output){
 const counts={tests:NaN,pass:NaN,fail:NaN,cancelled:NaN,skipped:NaN,todo:NaN};for(const [,key,value] of output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm))counts[key]=Number(value);
 if(['tests','pass','fail','cancelled','skipped','todo'].some(key=>!Number.isInteger(counts[key]))||counts.tests<1||counts.pass!==counts.tests||counts.fail||counts.cancelled||counts.skipped||counts.todo)throw Error('VERIFICATION_TEST_COUNTS_REJECTED');return counts;
}
export async function discoverTestInventory(root){
 const regression=[],browser=[];
 async function walk(folder){for(const e of await readdir(path.join(root,folder),{withFileTypes:true})){
  if(e.isSymbolicLink())throw Error('VERIFICATION_TEST_SYMLINK_FORBIDDEN');
  const file=folder+'/'+e.name;
  if(e.isDirectory())await walk(file);else if(e.isFile()&&e.name.endsWith('.test.ts'))(file.startsWith('tests/browser/')?browser:regression).push(file);
 }}
 await walk('tests');regression.sort();browser.sort();
 if(!regression.includes('tests/database-runtime-role.test.ts')||!browser.includes('tests/browser/authentication.test.ts'))throw Error('VERIFICATION_TEST_INVENTORY_INCOMPLETE');
 return {regression,browser};
}
export async function discoverRegressionTests(root){return (await discoverTestInventory(root)).regression;}
export async function sourceFingerprint(root){
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
 const selected=[...new Set(files)].filter(p=>/^(?:src\/|public\/|scripts\/|tests\/|prisma\/|contracts\/|infrastructure\/|compose\.yaml$|\.github\/|package(?:-lock)?\.json$|next\.config\.ts$|tsconfig\.json$)/.test(p)).sort();
 const hash=createHash('sha256');for(const file of selected){hash.update(file+'\0');hash.update(await readFile(path.join(root,file)));hash.update('\0');}
 return {algorithm:'sha256',sha256:hash.digest('hex'),files:selected.length};
}
