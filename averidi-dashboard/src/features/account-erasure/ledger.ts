import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,realpath,lstat,open,link,unlink,readdir,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {erasureDecision,requireErasureSettings,type ErasureDecision} from './contracts';
export function identityDigest(subject:string){return createHmac('sha256',requireErasureSettings().key).update('account-identity\0'+subject).digest('hex');}
async function root(){const {root}=requireErasureSettings();await mkdir(root,{recursive:true,mode:0o700});const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||await realpath(root)!==root)throw Error('ERASURE_LEDGER_UNAVAILABLE');return root;}
function signature(decision:ErasureDecision){return createHmac('sha256',requireErasureSettings().key).update('dashboard-account-erasure-v1\0'+JSON.stringify(decision)).digest('hex');}
export async function saveErasureDecision(value:unknown){
 const decision=erasureDecision.parse(value),directory=await root(),target=path.join(directory,decision.requestId+'.json'),bytes=Buffer.from(JSON.stringify({decision,signature:signature(decision)})+'\n'),temporary=target+'.tmp-'+randomUUID();
 try{const handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size!==bytes.length)throw Error('ERASURE_LEDGER_CONFLICT');const existing=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!(await existing.readFile()).equals(bytes))throw Error('ERASURE_LEDGER_CONFLICT');}finally{await existing.close();}}
  const dir=await open(directory,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function readErasureDecisions(){
 const directory=await root(),files=await readdir(directory);if(files.length>100000)throw Error('ERASURE_LEDGER_LIMIT');const decisions:ErasureDecision[]=[];
 for(const name of files){if(name.includes('.tmp-'))continue;if(!/^[a-f0-9-]{36}\.json$/.test(name))throw Error('ERASURE_LEDGER_INVALID');const file=path.join(directory,name),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size>256000)throw Error('ERASURE_LEDGER_INVALID');const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let data;try{data=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}const decision=erasureDecision.parse(data.decision);if(name!==decision.requestId+'.json'||typeof data.signature!=='string'||!/^[a-f0-9]{64}$/.test(data.signature)||!timingSafeEqual(Buffer.from(signature(decision),'hex'),Buffer.from(data.signature,'hex')))throw Error('ERASURE_LEDGER_INVALID');decisions.push(decision);
 }return decisions;
}
