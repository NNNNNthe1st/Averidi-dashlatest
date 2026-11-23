import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {privateDirectory,privateJson} from './development/environment.mjs';
import {emailEnvironment} from './development/email.mjs';
import {standaloneCodespacesOrigin} from './development/standalone.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
 const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
 if(branch!=='feature/independent-dashboard')throw Error('Configure email only on feature/independent-dashboard.');
 const settings={
  DASHBOARD_EMAIL_API_KEY:process.env.DASHBOARD_EMAIL_API_KEY,
  DASHBOARD_EMAIL_FROM:process.env.DASHBOARD_EMAIL_FROM||'Averidi <support@averidi.com>',
  DASHBOARD_PUBLIC_URL:process.env.DASHBOARD_PUBLIC_URL||(process.env.CODESPACES==='true'?standaloneCodespacesOrigin():'https://localhost:8443')
 };
 const validated=emailEnvironment(settings);
 const folder=path.join(root,'.local/development');await privateDirectory(folder);
 await privateJson(path.join(folder,'email.json'),Object.fromEntries(Object.keys(settings).map(key=>[key,validated[key]])));
 console.log('Private Dashboard email configuration saved. Restart dev:serve. No email has been sent.');
}catch(error){console.error(error.message);process.exitCode=1;}
