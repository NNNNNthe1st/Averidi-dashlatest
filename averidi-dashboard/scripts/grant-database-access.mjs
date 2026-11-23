import {PrismaClient} from '@prisma/client';
import * as boundaryModule from '../src/server/data-boundary.ts';
const {requireDashboardDatabaseUrl}=boundaryModule.default??boundaryModule;
const app=new URL(requireDashboardDatabaseUrl(process.env.DASHBOARD_DATABASE_URL));
const migration=new URL(requireDashboardDatabaseUrl(process.env.DASHBOARD_MIGRATION_DATABASE_URL));
const schema=app.searchParams.get('schema')??'public';
if(app.hostname!==migration.hostname||app.port!==migration.port||app.pathname!==migration.pathname||schema!==(migration.searchParams.get('schema')??'public')||app.username===migration.username)throw new Error('Separate runtime and migration roles must target the same dedicated Dashboard database and schema.');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const role=decodeURIComponent(app.username);
const db=new PrismaClient({datasources:{db:{url:migration.toString()}}});
try{
 const roles=await db.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=${role}`;
 if(roles.length!==1||Object.values(roles[0]).some(Boolean))throw new Error('Dashboard runtime role must exist without elevated privileges.');
 const owned=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=${schema} AND pg_has_role(${role},tableowner,'MEMBER')`;
 if(owned.length)throw new Error('Runtime role must not own or inherit ownership of Dashboard tables.');
 const tables=await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema=${schema}`;
 if(!tables.length||tables.some(t=>t.table_name!=='_prisma_migrations'&&!t.table_name.startsWith('Dashboard')))throw new Error('Grant refused: schema must contain only migrated Dashboard tables.');
 await db.$transaction(async tx=>{
  // Runtime is never the schema/table owner. Explicit grants do not include DDL or ledger writes.
  await tx.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA ${quote(schema)} FROM PUBLIC`);
  await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(role)}`);
  for(const t of tables){
   await tx.$executeRawUnsafe(`REVOKE ALL ON TABLE ${quote(schema)}.${quote(t.table_name)} FROM ${quote(role)}`);
   await tx.$executeRawUnsafe(`GRANT ${t.table_name==='_prisma_migrations'?'SELECT':'SELECT,INSERT,UPDATE,DELETE'} ON TABLE ${quote(schema)}.${quote(t.table_name)} TO ${quote(role)}`);
  }
 });
 console.log('Dashboard runtime table grants applied.');
}finally{await db.$disconnect();}
