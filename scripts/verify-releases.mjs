import {spawnSync} from 'node:child_process';
import {verificationDatabases} from './verification/contracts.mjs';
if(process.versions.node.split('.')[0]!=='22')throw Error('VERIFICATION_REQUIRES_NODE_22');
verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
for(const args of [['--import','tsx','scripts/migrate-database.mjs'],['node_modules/prisma/build/index.js','generate','--schema','prisma/schema.prisma'],['--import','tsx','--test','tests/release-infrastructure.test.ts'],['node_modules/typescript/bin/tsc','--noEmit'],['scripts/test-release-lifecycle.mjs']]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.error)throw result.error;if(result.status!==0){process.exitCode=result.status??1;break;}
}
