import {Prisma,PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import * as boundaryModule from '../src/server/data-boundary.ts';
const {requireDashboardDatabaseUrl}=boundaryModule.default??boundaryModule;
const db=new PrismaClient({datasources:{db:{url:requireDashboardDatabaseUrl(process.env.DASHBOARD_DATABASE_URL)}}});
try{
 const result=await db.$transaction(async tx=>{
  const tables=[...Prisma.dmmf.datamodel.models.map(m=>m.dbName??m.name),'_prisma_migrations'].sort();
  const manifest={};
  for(const table of tables){
   const rows=await tx.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row FROM "${table.replaceAll('"','""')}" t`);
   const values=rows.map(r=>r.row).sort();
   manifest[table]={rows:values.length,sha256:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
  }
  return manifest;
 },{isolationLevel:'RepeatableRead',timeout:30000});
 console.log(JSON.stringify(result));
}finally{await db.$disconnect();}
