import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {discoverRegressionTests,verificationDatabases} from './verification/contracts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const files=await discoverRegressionTests(root);
const child=spawn(process.execPath,['scripts/test-auth-worker.mjs',...files],{cwd:root,env:process.env,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
