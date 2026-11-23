import {lstat,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initializeHost,hostRoot,installRelease,verifyRelease} from './releases/artifact.mjs';
import {releaseHost,hostRequest} from './releases/host.mjs';
const [action,...args]=process.argv.slice(2);
async function main(){
 if(process.platform!=='linux'||process.versions.node.split('.')[0]!=='22')throw Error('RELEASE_REQUIRES_LINUX_NODE_22');
 if(action==='init'&&args.length===1)return {root:await initializeHost(args[0])};
 if(action==='verify'&&args.length===2){const r=await verifyRelease(args[0],args[1]);return {digest:r.digest,version:r.manifest.version,revision:r.manifest.revision};}
 if(action==='install'&&args.length===3){const r=await installRelease(args[0],args[1],args[2]);return {digest:r.digest,version:r.manifest.version};}
 if(action==='serve'&&args.length===1){const root=await hostRoot(args[0]);try{const lock=await lstat(root+'/host.lock');if(!lock.isFile()||lock.isSymbolicLink())throw Error('RELEASE_LOCK_REJECTED');}catch(e){if(e.code!=='ENOENT')throw e;const handle=await open(root+'/host.lock','wx',0o600);await handle.close();}const child=spawn('flock',['--nonblock','--no-fork',root+'/host.lock',process.execPath,fileURLToPath(import.meta.url),'_serve',root],{stdio:'inherit',env:{PATH:process.env.PATH}});const stop=()=>child.kill('SIGTERM');process.once('SIGTERM',stop);process.once('SIGINT',stop);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw Error('RELEASE_HOST_BUSY_OR_FAILED');return {stopped:true};}
 if(action==='_serve'&&args.length===1){const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());await releaseHost(args[0],controller.signal);return {stopped:true};}
 if(action==='status'&&args.length===1)return hostRequest(args[0],{action:'status'});
 if(action==='activate'&&(args.length===2||args.length===3&&args[2]==='--migrate')){const current=await hostRequest(args[0],{action:'status'});return hostRequest(args[0],{action:'activate',release:args[1],expectedCurrent:current.current,migrate:args[2]==='--migrate'});}
 if(action==='rollback'&&args.length===1){const current=await hostRequest(args[0],{action:'status'});return hostRequest(args[0],{action:'rollback',expectedCurrent:current.current});}
 throw Error('RELEASE_INVALID_COMMAND');
}
main().then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error instanceof Error&&/^RELEASE_[A-Z_]+$/.test(error.message)?error.message:'RELEASE_OPERATION_FAILED');process.exitCode=1;});
