import {PrismaClient} from '@prisma/client';
import {verificationDatabases} from './verification/contracts.mjs';
const {runtime,owner}=verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:owner.toString()}}});
try{
 const tables=await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
 if(!tables.length||tables.some(t=>t.table_name!=='_prisma_migrations'&&!t.table_name.startsWith('Dashboard')))throw Error('Unsafe verification database');
 const role=decodeURIComponent(runtime.username),existing=await db.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=${role}`;
 if(existing.length){if(Object.values(existing[0]).some(Boolean))throw Error('Existing runtime role is elevated');}
 else{
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  await db.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD ${quote(decodeURIComponent(runtime.password))} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
 }
 console.log('Dedicated verification runtime role is present without elevated privileges.');
}catch{console.error('VERIFICATION_ROLE_FAILED');process.exitCode=1;}finally{await db.$disconnect();}
