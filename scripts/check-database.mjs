import {Prisma,PrismaClient} from '@prisma/client';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as boundaryModule from '../src/server/data-boundary.ts';
const {requireDashboardDatabaseUrl}=boundaryModule.default??boundaryModule;
const url=requireDashboardDatabaseUrl(process.env.DASHBOARD_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url}}});
try{
 const identity=await db.$queryRaw`SELECT current_database() AS name,current_user AS role`;
 if(identity[0]?.name!==decodeURIComponent(new URL(url).pathname.slice(1)))throw new Error('Unexpected Dashboard database identity.');
 const tables=await db.$queryRaw`SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema()`;
 const found=new Set(tables.map(t=>t.name));
 const models=Prisma.dmmf.datamodel.models;
 for(const model of models)if(!found.has(model.dbName??model.name))throw new Error('Missing Dashboard table: '+model.name);
 if([...found].some(n=>n!=='_prisma_migrations'&&!models.some(m=>(m.dbName??m.name)===n)))throw new Error('Unexpected tables in dedicated Dashboard schema.');
 const columns=await db.$queryRaw`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()`;
 for(const model of models)for(const field of model.fields.filter(f=>f.kind!=='object')){
  if(!columns.some(c=>c.table_name===(model.dbName??model.name)&&c.column_name===(field.dbName??field.name)))throw new Error('Missing Dashboard column: '+model.name+'.'+field.name);
 }
 const migrations=await db.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`;
 if(migrations.some(m=>!m.finished_at&&!m.rolled_back_at))throw new Error('Incomplete Dashboard migration.');
 const expected=(await readdir('prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name);
 for(const name of expected){
  const row=migrations.find(m=>m.migration_name===name&&m.finished_at&&!m.rolled_back_at);
  const checksum=createHash('sha256').update(await readFile(`prisma/migrations/${name}/migration.sql`)).digest('hex');
  if(!row||row.checksum!==checksum)throw new Error('Missing or changed Dashboard migration: '+name);
 }
 if(migrations.some(m=>m.finished_at&&!m.rolled_back_at&&!expected.includes(m.migration_name)))throw new Error('Database contains unknown Dashboard migrations.');
 console.log(JSON.stringify({database:identity[0].name,role:identity[0].role,checkedTables:models.length,migrations:expected.length,status:'ok'}));
}finally{await db.$disconnect();}
