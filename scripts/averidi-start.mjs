// One command to run Averidi Dashboard for review: npm run averidi:start
// - First run prepares the private development database (npm run dev:setup).
// - Builds the app and starts the web app plus the background worker.
// - Works in GitHub Codespaces (HTTPS via forwarded port 3000) and locally (HTTPS on https://localhost:3000).
// - Without an email provider, account verification links are printed in this terminal.
// - Google Sheets is enabled once `npm run averidi:google-sheets` has saved an OAuth client.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import https from 'node:https';import http from 'node:http';import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readyDevelopmentRuntime} from './development/ready.mjs';
import {standaloneCodespacesSettings} from './development/standalone.mjs';
import {emailEnvironment,readDevelopmentEmail} from './development/email.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const children=[];let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;for(const c of children){try{process.kill(-c.pid,'SIGTERM');}catch{c.kill('SIGTERM');}}setTimeout(()=>process.exit(process.exitCode??0),3000).unref();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const run=(cmd,args,env)=>{const r=spawnSync(cmd,args,{cwd:root,env,stdio:'inherit'});if(r.status!==0)throw Error(`${[cmd,...args].join(' ')} failed.`);};
try{
 if(process.versions.node.split('.')[0]!=='22')throw Error('Averidi needs Node 22. In Codespaces run: nvm install 22 && nvm use 22');
 if(!existsSync(path.join(root,'node_modules')))run('npm',['ci'],process.env);
 if(!existsSync(path.join(root,'.local/development/runtime.json'))){console.log('First run: preparing the private development database...');run('npm',['run','dev:setup'],process.env);}
 const env=await readyDevelopmentRuntime(root);
 const codespaces=process.env.CODESPACES==='true';
 if(codespaces)Object.assign(env,standaloneCodespacesSettings());
 else Object.assign(env,{NODE_ENV:'development',DASHBOARD_PUBLIC_ORIGIN:'https://localhost:3000',DASHBOARD_PUBLIC_URL:'https://localhost:3000',DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_BETA_WORKSPACE_IDS:''});
 const origin=env.DASHBOARD_PUBLIC_ORIGIN;
 // Email: use the configured provider when present, otherwise print links in this terminal.
 // Sources, in order: Codespaces secrets / shell variables, then `npm run dev:email:configure`.
 let email={},emailNote='';
 if(process.env.DASHBOARD_EMAIL_API_KEY&&process.env.DASHBOARD_EMAIL_FROM){
  try{email=emailEnvironment({DASHBOARD_EMAIL_API_KEY:process.env.DASHBOARD_EMAIL_API_KEY,DASHBOARD_EMAIL_FROM:process.env.DASHBOARD_EMAIL_FROM,DASHBOARD_PUBLIC_URL:origin},origin);}catch(error){emailNote=`Resend secrets found but not used: ${error.message}`;}
 }else{
  try{email=await readDevelopmentEmail(root,origin);}catch(error){emailNote=`Saved email settings not used: ${error.message}`;}
 }
 if(email.DASHBOARD_EMAIL_API_KEY)Object.assign(env,email);else env.DASHBOARD_DEVELOPMENT_EMAIL_CONSOLE='true';
 // Google Sheets connection.
 // Connections (Google Sheets, Shopify): saved keys, or Codespaces secrets with the same names.
 const enabled={};
 for(const [provider,file] of [['GOOGLE_SHEETS','google-sheets.json'],['SHOPIFY','shopify.json']]){
  let clientId=process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_ID`],clientSecret=process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_SECRET`];
  const saved=path.join(root,'.local/development',file);
  if(existsSync(saved)){const info=lstatSync(saved);if(!info.isFile()||(info.mode&0o077))throw Error(`.local/development/${file} must be private (chmod 600).`);({clientId,clientSecret}=JSON.parse(readFileSync(saved,'utf8')));}
  if(clientId&&clientSecret){Object.assign(env,{DASHBOARD_DATA_CONNECTORS_ENABLED:'true',[`DASHBOARD_CONNECTOR_${provider}_CLIENT_ID`]:clientId,[`DASHBOARD_CONNECTOR_${provider}_CLIENT_SECRET`]:clientSecret});enabled[provider]=true;}
 }
 // Production build (stable, fast pages). The web process always runs on 3001; port 3000 is the public entry.
 console.log('Building Averidi Dashboard (first build takes a few minutes)...');
 // Next.js can stop the first build after printing a one-time notice; one automatic retry continues it.
 const build=()=>spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:root,env:{...env,NODE_ENV:'production'},stdio:'inherit'}).status===0;
 if(!build()&&!build())throw Error('The build failed. See the messages above.');
 const webEnv={...env,NODE_ENV:'production'};
 for(const args of [['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3001'],['--import','tsx','src/worker/service.ts']]){
  const child=spawn(process.execPath,args,{cwd:root,env:webEnv,detached:true,stdio:'inherit'});children.push(child);
  child.once('exit',()=>{if(!stopping){console.error('A process stopped unexpectedly; shutting down.');process.exitCode=1;stop();}});
 }
 // Entry on port 3000: plain HTTP in Codespaces (GitHub adds HTTPS), self-signed HTTPS locally.
 const forward=(req,res)=>{const headers={...req.headers};
  // Codespaces forwarding rewrites Origin to localhost but keeps Referer; restore the public origin for same-site requests.
  if(codespaces&&['http://localhost:3000','https://localhost:3000'].includes(headers.origin??'')&&String(headers.referer??'').startsWith(origin+'/'))headers.origin=origin;
  const p=http.request({host:'127.0.0.1',port:3001,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res);});p.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Averidi is starting. Refresh in a few seconds.');});req.pipe(p);};
 let server;
 if(codespaces)server=http.createServer(forward);
 else{
  const certDir=path.join(root,'.local/development/https');const key=path.join(certDir,'key.pem'),cert=path.join(certDir,'cert.pem');
  if(!existsSync(key)){spawnSync('mkdir',['-p',certDir]);const r=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','365','-subj','/CN=localhost'],{stdio:'ignore'});if(r.status!==0)throw Error('Local HTTPS needs openssl installed (or use GitHub Codespaces).');}
  server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},forward);
 }
 server.on('upgrade',(req,socket,head)=>{const u=net.connect(3001,'127.0.0.1',()=>{u.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');u.write(head);socket.pipe(u).pipe(socket);});u.on('error',()=>socket.destroy());socket.on('error',()=>u.destroy());});
 server.listen(3000,codespaces?'0.0.0.0':'127.0.0.1');
 console.log(`\n  Averidi Dashboard: ${origin}/dashboard/app/signup`);
 console.log(`  Email: ${env.DASHBOARD_DEVELOPMENT_EMAIL_CONSOLE?'verification links are printed here in the terminal (to send real emails, add Codespaces secrets DASHBOARD_EMAIL_API_KEY and DASHBOARD_EMAIL_FROM)':'sent through Resend from '+env.DASHBOARD_EMAIL_FROM}`);
 if(emailNote)console.log(`  ${emailNote}`);
 const callback=origin+'/dashboard/app/api/connectors/callback';
 console.log(`  Google Sheets: ${enabled.GOOGLE_SHEETS?'enabled':'off (run npm run averidi:google-sheets to enable)'}`);
 console.log(`  Shopify: ${enabled.SHOPIFY?'enabled':'off (run npm run averidi:shopify to enable)'}`);
 console.log(`  Redirect URL to register in Google Cloud and Shopify: ${callback}`);
 if(!codespaces)console.log('  Your browser will warn about the local certificate the first time; choose Advanced > Proceed.');
 console.log('  Press Ctrl+C to stop.\n');
}catch(error){console.error(error.message);stop();process.exitCode=1;}
