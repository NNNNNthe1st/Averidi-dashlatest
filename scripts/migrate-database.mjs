import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import * as boundaryModule from '../src/server/data-boundary.ts';
const {requireDashboardDatabaseUrl}=boundaryModule.default??boundaryModule;
const url=requireDashboardDatabaseUrl(process.env.DASHBOARD_MIGRATION_DATABASE_URL??process.env.DASHBOARD_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url}}});
try{
 const identity=await db.$queryRaw`SELECT current_database() AS name`;
 if(identity[0]?.name!==decodeURIComponent(new URL(url).pathname.slice(1)))throw new Error('Unexpected database identity.');
 const tables=await db.$queryRaw`SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema()`;
 if(tables.some(row=>row.name!=='_prisma_migrations'&&!row.name.startsWith('Dashboard')))throw new Error('Refusing migration: non-Dashboard tables exist in the selected schema.');
}finally{await db.$disconnect();}
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','prisma/schema.prisma'],{stdio:'inherit',env:{...process.env,DASHBOARD_DATABASE_URL:url}});
if(result.error)throw result.error;
process.exitCode=result.status??1;

