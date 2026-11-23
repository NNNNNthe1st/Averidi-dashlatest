import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readDevelopmentSettings} from './development/environment.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const separator=process.argv.indexOf('--');
if(separator<0||separator===process.argv.length-1){
 console.error('Usage: node scripts/with-development-database.mjs -- <command> [args...]');
 process.exit(2);
}
const [command,...args]=process.argv.slice(separator+1);
const env={...process.env};
if(!env.DASHBOARD_DATABASE_URL){
 try{
  const settings=await readDevelopmentSettings(root);
  env.DASHBOARD_DATABASE_URL=settings.databaseUrl;
 }catch(error){
  console.error('DASHBOARD_DATABASE_URL is unset and the private local development runtime is unavailable. Run npm run dev:setup, or provide DASHBOARD_DATABASE_URL explicitly.');
  process.exit(1);
 }
}
const child=spawn(command,args,{cwd:root,env,stdio:'inherit',shell:false});
child.once('error',error=>{console.error('Unable to start database-backed command:',error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{
 if(signal){process.kill(process.pid,signal);return;}
 process.exitCode=code??1;
});
