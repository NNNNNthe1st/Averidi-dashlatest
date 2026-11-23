import type {Prisma} from '@prisma/client';
export async function setAuditActor(tx:Prisma.TransactionClient,actor:{issuer:string;subject:string;userId?:string},source:'APPLICATION'|'WORKER'='APPLICATION'){
 if(!actor.issuer||!actor.subject||actor.issuer.length>2048||actor.subject.length>2048)throw Error('INVALID_AUDIT_ACTOR');
 if(actor.userId){const [lock]=await tx.$queryRaw<{allowed:boolean}[]>`SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${'dashboard-erasure-user:'+actor.userId},0)) AS allowed`;if(!lock.allowed)throw Error('ACCOUNT_ERASURE_BUSY');if(await tx.dashboardUser.count({where:{id:actor.userId,erasureRequestedAt:{not:null}}}))throw Error('ACCOUNT_ERASING');}
 await tx.$queryRaw`SELECT set_config('dashboard.audit_issuer',${actor.issuer},true),set_config('dashboard.audit_subject',${actor.subject},true),set_config('dashboard.audit_user',${actor.userId??''},true),set_config('dashboard.audit_source',${source},true)`;
}
