import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import https from 'node:https';
import {PrismaClient} from '@prisma/client';
import {privateDirectory,privateJson,readDevelopmentSettings,developmentRuntime} from './development/environment.mjs';
import {codespacesOrigins,codespacesOidcSettings} from './development/codespaces.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),folder=path.join(root,'.local/identity-codespaces'),importFolder=path.join(folder,'import');
try{
 if(process.versions.node.split('.')[0]!=='22'||process.argv.length!==2)throw Error('Use Node 22 and npm run dev:codespaces:setup.');
 const origins=codespacesOrigins(),settings=await readDevelopmentSettings(root),runtime=developmentRuntime(settings,root);
 await privateDirectory(folder);await privateDirectory(importFolder);
 const statefile=path.join(folder,'identity.json');let state;
 try{const info=await lstat(statefile);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Unsafe preview identity state.');state=JSON.parse(await readFile(statefile,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;state={subject:randomUUID(),workspaceId:'dashboard_preview_'+randomUUID().replaceAll('-',''),password:randomBytes(24).toString('base64url')};await privateJson(statefile,state,{create:true});}
 if(!/^[a-f0-9-]{36}$/.test(state.subject)||!/^dashboard_preview_[a-f0-9]{32}$/.test(state.workspaceId)||!/^[A-Za-z0-9_-]{32}$/.test(state.password))throw Error('Invalid preview identity state.');
 const realm=JSON.parse(await readFile(path.join(root,'infrastructure/development/identity/realm.json'),'utf8'));
 realm.clients[0].redirectUris=[origins.app+'/dashboard/app/api/auth/callback'];realm.clients[0].webOrigins=[origins.app];
 realm.users[0].email='dashboard-developer@example.invalid';realm.users[0].id=state.subject;realm.users[0].credentials[0].value=state.password;
 const realmfile=path.join(importFolder,'dashboard-development-realm.json');await privateJson(realmfile,realm);
 const env={...runtime,DASHBOARD_DEV_IDENTITY_ORIGIN:origins.identity,DASHBOARD_DEV_REALM_DIR:importFolder};
 const compose=['compose','--project-name','averidi-dashboard-codespaces-identity','-f','infrastructure/development/codespaces/compose.yaml'];
 function run(args,capture=false){const result=spawnSync('docker',[...compose,...args],{cwd:root,env,encoding:'utf8',stdio:capture?'pipe':'inherit',timeout:300000});if(result.error||result.status!==0)throw Error('Codespaces identity setup failed at Docker '+args[0]+'.');return result.stdout;}
 run(['up','-d']);let copied=false;
 for(let attempt=0;attempt<60;attempt++){try{run(['cp','dashboard-development-tls:/data/caddy/pki/authorities/local/root.crt',path.join(folder,'root.crt')],true);copied=true;break;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
 if(!copied)throw Error('Local identity CA was not created.');
 const ca=await readFile(path.join(folder,'root.crt'));let ready=false,lastReadinessError='No discovery response was received.';
 for(let attempt=0;attempt<90;attempt++){
  try{
   const metadata=await new Promise((resolve,reject)=>{const request=https.get('https://localhost:9443/realms/dashboard-development/.well-known/openid-configuration',{ca},response=>{let body='';response.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy(Error('Oversized metadata.'));});response.on('end',()=>{try{if(response.statusCode!==200)throw Error('Identity discovery returned HTTP '+response.statusCode+'.');resolve(JSON.parse(body));}catch(error){reject(error);}});response.on('error',reject);});request.setTimeout(3000,()=>request.destroy(Error('Identity timeout.')));request.on('error',reject);});
   if(metadata.issuer!==origins.issuer||metadata.authorization_endpoint!==origins.issuer+'/protocol/openid-connect/auth'||metadata.token_endpoint!==origins.issuer+'/protocol/openid-connect/token'||metadata.jwks_uri!==origins.issuer+'/protocol/openid-connect/certs')throw Error('OIDC metadata mismatch: issuer='+(metadata.issuer??'(missing)')+'; expected='+origins.issuer+'.');
   ready=true;break;
  }catch(error){lastReadinessError=error?.message??String(error);await new Promise(resolve=>setTimeout(resolve,1000));}
 }
 if(!ready)throw Error('Codespaces identity did not become ready. Last readiness error: '+lastReadinessError);
 const db=new PrismaClient({datasources:{db:{url:runtime.DASHBOARD_DATABASE_URL}}});
 try{
  const identity=await db.$queryRaw`SELECT current_database() AS name,current_user AS role`;
  if(identity[0].name!=='dashboard_dev'||identity[0].role!=='dashboard_development_runtime')throw Error('Preview seed requires the dedicated development runtime.');
  await db.$transaction(async tx=>{
   const user=await tx.dashboardUser.upsert({where:{externalSubject:origins.issuer+'|'+state.subject},create:{externalSubject:origins.issuer+'|'+state.subject},update:{}});
   await tx.dashboardWorkspace.upsert({where:{id:state.workspaceId},create:{id:state.workspaceId,name:'Dashboard development preview'},update:{}});
   await tx.dashboardMembership.upsert({where:{userId_workspaceId:{userId:user.id,workspaceId:state.workspaceId}},create:{userId:user.id,workspaceId:state.workspaceId,role:'OWNER'},update:{}});
   await tx.dashboardSubscription.upsert({where:{workspaceId:state.workspaceId},create:{workspaceId:state.workspaceId,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+30*86400000)},update:{status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+30*86400000)}});
  });
 }finally{await db.$disconnect();}
 await privateJson(path.join(folder,'settings.json'),{...codespacesOidcSettings(),workspaceId:state.workspaceId});
 console.log('Codespaces development identity and preview workspace are ready. Keep forwarded ports 3000 and 8081 PRIVATE.');
 console.log('Developer login: dashboard-developer');console.log('Developer password: '+state.password);
 console.log('Start: npm run dev:serve -- --codespaces');
 console.log('Open: '+origins.app+'/dashboard/app/api/auth/login');
}catch(error){console.error(error.message);process.exitCode=1;}
