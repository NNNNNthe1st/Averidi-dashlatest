/** Public commercial fields only. No provider IDs, keys, bindings or customers. */
export async function publicDashboardPlans(){
 if(process.env.DASHBOARD_BILLING_ENABLED!=='true'||process.env.DASHBOARD_BILLING_SELF_SERVICE_ENABLED!=='true')return {available:false,plans:[]};
 try{
  const {customerBillingSettings}=await import('./self-service');customerBillingSettings();
  const {dashboardDb}=await import('../../server/db');
  const rows=await dashboardDb.dashboardBillingPlan.findMany({where:{active:true,externalPriceId:{not:null}},orderBy:{code:'asc'},take:100,select:{name:true,currency:true,amountMinor:true,billingInterval:true,entitlements:true}});
  const plans=rows.filter(p=>(p.entitlements as {dashboardAccess?:boolean})?.dashboardAccess===true&&p.currency&&p.amountMinor!==null&&['month','year'].includes(p.billingInterval??'')).map(p=>({name:p.name,currency:p.currency!,amountMinor:p.amountMinor!,billingInterval:p.billingInterval!}));
  return {available:true,plans};
 }catch{return {available:false,plans:[]};}
}
