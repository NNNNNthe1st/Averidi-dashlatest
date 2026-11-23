import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verificationDatabases} from './verification/contracts.mjs';
if(process.versions.node.split('.')[0]!=='22')throw Error('VERIFICATION_REQUIRES_NODE_22');
// Refuse development/customer databases before migration or fixture writes.
verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const stages=[
 ['node_modules/prisma/build/index.js','validate','--schema','prisma/schema.prisma'],
 ['--import','tsx','scripts/migrate-database.mjs'],
 ['node_modules/prisma/build/index.js','generate','--schema','prisma/schema.prisma'],
 ['scripts/test-auth-worker.mjs','tests/custom-sources.test.ts','tests/marketing-connectors.test.ts'],
 ['scripts/clean-verification-build.mjs'],
 ['node_modules/next/dist/bin/next','typegen'],
 ['node_modules/typescript/bin/tsc','--noEmit'],
 ['node_modules/next/dist/bin/next','build'],
 ['--import','tsx','scripts/test-custom-sources-browser.mjs'],
 ['--import','tsx','scripts/test-bi-browser.mjs'],
 ['scripts/test-auth-worker.mjs','tests/browser/authentication.test.ts'],
];
const completed=[];
for(const args of stages){
 console.log('RUN custom-sources verification: '+args.join(' '));
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.error)throw result.error;
 if(result.status!==0||result.signal)throw Error('CUSTOM_SOURCES_VERIFICATION_STAGE_FAILED: '+args.join(' '));
 completed.push({args,status:result.status});
}
if(process.env.DASHBOARD_CUSTOM_SOURCES_VERIFICATION_REPORT)writeFileSync(process.env.DASHBOARD_CUSTOM_SOURCES_VERIFICATION_REPORT,JSON.stringify({passed:true,completed},null,2)+'\n');
console.log('PASS custom-sources verification: all '+completed.length+' stages completed.');
