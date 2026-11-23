import {spawn} from 'node:child_process';
import {verificationDatabases} from './verification/contracts.mjs';
// Refuse to run worker/import fixtures against development or production data.
verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const files=['tests/database-runtime-role.test.ts','tests/source-quality.test.ts','tests/query-cache.test.ts','tests/comparison-periods.test.ts','tests/sales-preparation-integration.test.ts','tests/sales-engine-regression-integration.test.ts','tests/bi-workflow.test.ts'];
const child=spawn(process.execPath,['scripts/test-auth-worker.mjs',...files],{stdio:'inherit',env:process.env});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
