import * as dbModule from '../src/server/db.ts';
const {dashboardDb:db}=dbModule.default??dbModule;
import * as contractsModule from '../src/features/billing/contracts.ts';
const {billingConfig}=contractsModule.default??contractsModule;
import * as billingModule from '../src/features/billing/service.ts';
const {reconcileBilling}=billingModule.default??billingModule;
// Bounded pages and sequential per-workspace locks; suitable for an independent scheduled operator job.
const args=process.argv.slice(2);const workspace=args[0];
if(args.length>1||(workspace&&!/^[A-Za-z0-9_-]{1,128}$/.test(workspace)))throw Error('Usage: npm run billing:reconcile -- [workspaceId]');
let cursor,checked=0,failed=0;
try{
 billingConfig();
 do{
  const page=await db.dashboardBillingBinding.findMany({where:workspace?{workspaceId:workspace}:{},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,workspaceId:true}});
  for(const row of page){try{await reconcileBilling(row.workspaceId,{issuer:'dashboard:billing:operator',subject:'reconciliation-cli'});checked++;}catch{failed++;console.error(JSON.stringify({workspaceId:row.workspaceId,error:'BILLING_RECONCILIATION_FAILED'}));}}
  cursor=!workspace&&page.length===100?page.at(-1).id:undefined;
 }while(cursor);
 if(workspace&&checked+failed===0)throw Error('BILLING_BINDING_NOT_FOUND');
 console.log(JSON.stringify({checked,failed}));if(failed)process.exitCode=1;
}catch(error){console.error(error instanceof Error&&/^BILLING_[A-Z_]+$/.test(error.message)?error.message:'BILLING_OPERATION_FAILED');process.exitCode=1;}finally{await db.$disconnect();}
