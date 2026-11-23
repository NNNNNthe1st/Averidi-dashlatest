import {spawn} from 'node:child_process';
import {verificationDatabases} from './verification/contracts.mjs';
verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
// Discard inherited release/provider configuration before executing isolated fixtures.
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DASHBOARD_')));
for(const key of ['DASHBOARD_DATABASE_URL','DASHBOARD_MIGRATION_DATABASE_URL'])env[key]=process.env[key];
const child=spawn(process.execPath,['scripts/test-auth-worker.mjs','tests/operational-monitoring.test.ts'],{env,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
