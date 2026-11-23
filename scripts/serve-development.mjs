import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {standaloneCodespacesSettings} from './development/standalone.mjs';
import {codespacesPreviewLaunch} from './development/codespaces-launcher.mjs';
import {readyDevelopmentRuntime} from './development/ready.mjs';
import {readDevelopmentEmail} from './development/email.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const children=[];let stopping=false,failed=false;
function kill(child,signal){try{process.kill(-child.pid,signal);}catch{child.kill(signal);}}
function stop(){if(stopping)return;stopping=true;for(const child of children)kill(child,'SIGTERM');setTimeout(()=>{for(const child of children)if(child.exitCode===null)kill(child,'SIGKILL');},5000).unref();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 if(process.versions.node.split('.')[0]!=='22')throw Error('Development requires Node 22.');
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--codespaces','--accounts'].includes(arg))||new Set(args).size!==args.length||(args.includes('--accounts')&&!args.includes('--codespaces')))throw Error('Usage: npm run dev:serve [-- --codespaces [--accounts]]');
 const env=await readyDevelopmentRuntime(root);
 const host='127.0.0.1';
 let preload=[],previewLoginUrl;
 if(args.includes('--codespaces')&&!args.includes('--accounts')){
  const preview=await codespacesPreviewLaunch(root);
  Object.assign(env,preview.env);
  preload=preview.preload;
  previewLoginUrl=preview.loginUrl;
  console.log('Codespaces preview login: '+previewLoginUrl);
 }else{
  if(args.includes('--codespaces'))Object.assign(env,standaloneCodespacesSettings());
  const email=await readDevelopmentEmail(root,env.DASHBOARD_PUBLIC_ORIGIN);
  if(!email.DASHBOARD_EMAIL_API_KEY)throw Error('Run npm run dev:email:configure before starting standalone account development.');
  Object.assign(env,email);
  console.log('Standalone signup: '+env.DASHBOARD_PUBLIC_ORIGIN+'/dashboard/app/signup');
 }
 console.log('Starting independent Dashboard web and worker processes; migration-owner credentials are absent.');
 for(const args of [['node_modules/next/dist/bin/next','dev','--hostname',host,'--port','3000'],['--import','tsx','src/worker/service.ts']]){
  const child=spawn(process.execPath,[...preload,...args],{cwd:root,env,detached:process.platform!=='win32',stdio:'inherit'});children.push(child);
  child.once('error',()=>{failed=true;stop();});
  child.once('exit',(code,signal)=>{if(!stopping){failed=true;console.error('A development process stopped unexpectedly; shutting down both processes.');stop();}if(code&&!signal)failed=true;});
 }
 await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('close',resolve);})));if(failed)process.exitCode=1;
}catch(error){stop();console.error(error.message);process.exitCode=1;}
