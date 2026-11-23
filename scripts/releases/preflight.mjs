import {PrismaClient} from '@prisma/client';
const db=new PrismaClient({datasources:{db:{url:process.env.DASHBOARD_DATABASE_URL}}});
try{
 const roles=await db.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
 const owners=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND pg_has_role(current_user,tableowner,'MEMBER')`;
 if(roles.length!==1||Object.values(roles[0]).some(Boolean)||owners.length)throw Error('RELEASE_ELEVATED_RUNTIME_ROLE');
}catch{console.error('RELEASE_DATABASE_ROLE_REJECTED');process.exitCode=1;}finally{await db.$disconnect();}
