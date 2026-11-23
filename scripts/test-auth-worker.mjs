import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
const root=await mkdtemp(path.join(tmpdir(),'dashboard-oidc-tls-'));
try{
 const cert=path.join(root,'cert.pem'),key=path.join(root,'key.pem');
 const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{encoding:'utf8'});
 if(generated.error)throw generated.error;
 if(generated.status!==0)throw new Error('Unable to create the isolated OIDC test TLS certificate.');
 const reportDirectory=process.env.DASHBOARD_TEST_REPORT_DIRECTORY;
 const reporters=['--test-reporter=tap','--test-reporter-destination=stdout'];
 if(reportDirectory){await mkdir(reportDirectory,{recursive:true});reporters.push('--test-reporter=junit','--test-reporter-destination='+path.join(reportDirectory,'junit.xml'));}
 const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...reporters,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:cert,DASHBOARD_TEST_TLS_CERT:cert,DASHBOARD_TEST_TLS_KEY:key}});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{await rm(root,{recursive:true,force:true});}
