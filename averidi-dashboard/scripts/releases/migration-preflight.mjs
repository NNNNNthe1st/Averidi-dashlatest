import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
const runtime=new URL(process.env.DASHBOARD_DATABASE_URL??''),owner=new URL(process.env.DASHBOARD_MIGRATION_DATABASE_URL??'');
if(!['postgres:','postgresql:'].includes(owner.protocol)||runtime.hostname!==owner.hostname||runtime.port!==owner.port||runtime.pathname!==owner.pathname||(runtime.searchParams.get('schema')??'public')!==(owner.searchParams.get('schema')??'public')||runtime.username===owner.username)throw Error('RELEASE_MIGRATION_DATABASE_REJECTED');
const db=new PrismaClient({datasources:{db:{url:owner.toString()}}});
try{
 const role=decodeURIComponent(runtime.username),roles=await db.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=${role}`;
 if(roles.length!==1||Object.values(roles[0]).some(Boolean))throw Error('RELEASE_ELEVATED_RUNTIME_ROLE');
 const owned=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND pg_has_role(${role},tableowner,'MEMBER')`;if(owned.length)throw Error('RELEASE_ELEVATED_RUNTIME_ROLE');
 const exists=await db.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='_prisma_migrations'`;
 if(exists.length){const ledger=await db.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;const expected=JSON.parse(await readFile('release.json','utf8')).migrations;const applied=ledger.filter(m=>!m.rolled_back_at);if(applied.some((m,i)=>!m.finished_at||m.migration_name!==expected[i]?.name||m.checksum!==expected[i]?.sha256))throw Error('RELEASE_MIGRATION_HISTORY_REJECTED');}
}finally{await db.$disconnect();}
