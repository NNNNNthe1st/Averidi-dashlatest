import {constants} from 'node:fs';
import {open,realpath,lstat,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {initialState,validateState} from './policy.mjs';

/** Operator provisions this directory: no implicit fallback or shared storage. */
export async function stateDirectory(value){
 if(!value||!path.isAbsolute(value)||path.normalize(value)!==value)throw Error('MONITOR_STATE_DIRECTORY_INVALID');
 const stat=await lstat(value);if(await realpath(value)!==value||!stat.isDirectory()||(stat.mode&0o077))throw Error('MONITOR_STATE_DIRECTORY_INVALID');return value;
}
async function privateFile(file,flags){const h=await open(file,flags|constants.O_NOFOLLOW,0o600);try{const stat=await h.stat();if(!stat.isFile()||(stat.mode&0o077)||stat.nlink!==1)throw Error('MONITOR_STATE_FILE_INVALID');return h;}catch(error){await h.close();throw error;}}
export async function acquireMonitorLock(directory){
 const file=path.join(directory,'monitor.lock');const handle=await privateFile(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);
 try{await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})+'\n');await handle.sync();}catch(error){await handle.close();await rm(file);throw error;}
 return async()=>{await handle.close();await rm(file);};
}
export async function loadMonitorState(directory){
 let h;try{h=await privateFile(path.join(directory,'state.json'),constants.O_RDONLY);}catch(error){if(error.code==='ENOENT')return initialState();throw error;}
 try{if((await h.stat()).size>32768)throw Error('MONITOR_STATE_INVALID');return validateState(JSON.parse(await h.readFile('utf8')));}finally{await h.close();}
}
export async function saveMonitorState(directory,state){
 validateState(state);const file=path.join(directory,'state.json'),temporary=path.join(directory,randomUUID()+'.tmp');
 const h=await privateFile(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);
 try{await h.writeFile(JSON.stringify(state)+'\n');await h.sync();await h.close();await rename(temporary,file);const dir=await open(directory,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}
 finally{await h.close().catch(()=>{});await rm(temporary,{force:true});}
}
