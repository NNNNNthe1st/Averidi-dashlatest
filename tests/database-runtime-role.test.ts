import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
after(()=>db.$disconnect());
test('runtime role can use Dashboard data without DDL, ownership or migration-ledger writes',async()=>{
 const roles=await db.$queryRaw<Array<Record<string,boolean>>>`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
 assert.equal(Object.values(roles[0]).some(Boolean),false);
 const permissions=await db.$queryRaw<Array<{create:boolean,read:boolean,write:boolean}>>`SELECT has_schema_privilege(current_user,current_schema(),'CREATE') AS create,has_table_privilege(current_user,'"_prisma_migrations"','SELECT') AS read,has_table_privilege(current_user,'"_prisma_migrations"','UPDATE') AS write`;
 assert.deepEqual(permissions[0],{create:false,read:true,write:false});
 const owners=await db.$queryRaw<Array<{tablename:string}>>`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND pg_has_role(current_user,tableowner,'MEMBER')`;
 assert.equal(owners.length,0);
 await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('CREATE TABLE "DashboardRuntimeDenied" (id text)');throw Error('DDL_WAS_ALLOWED');}),(e:any)=>e.code==='P2010'&&e.meta?.code==='42501');
 await assert.rejects(db.$executeRawUnsafe('UPDATE "_prisma_migrations" SET checksum=checksum WHERE false'),(e:any)=>e.code==='P2010'&&e.meta?.code==='42501');
});
