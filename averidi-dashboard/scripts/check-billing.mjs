import * as dbModule from '../src/server/db.ts';
const {dashboardDb:db}=dbModule.default??dbModule;
import * as contractsModule from '../src/features/billing/contracts.ts';
const {billingConfig}=contractsModule.default??contractsModule;
try{
 const config=billingConfig();
 const [bindings,unreconciled,stale,unmapped,checkoutRecoveryRequired,checkoutPastExpiry]=await Promise.all([
  db.dashboardBillingBinding.count(),db.dashboardBillingBinding.count({where:{reconciledAt:null}}),
  db.dashboardBillingBinding.count({where:{reconciledAt:{lt:new Date(Date.now()-86400000)}}}),
  db.dashboardSubscription.count({where:{planCode:'UNMAPPED'}}),
  db.dashboardCheckoutAttempt.count({where:{activeKey:'ACTIVE',externalSessionId:null,createdAt:{lt:new Date(Date.now()-23*3600000)}}}),
  db.dashboardCheckoutAttempt.count({where:{activeKey:'ACTIVE',expiresAt:{lt:new Date()}}}),
 ]);
 console.log(JSON.stringify({provider:'STRIPE',mode:config.live?'live':'test',bindings,unreconciled,stale,unmapped,checkoutRecoveryRequired,checkoutPastExpiry}));
 if(unreconciled||stale||unmapped||checkoutRecoveryRequired||checkoutPastExpiry)process.exitCode=1;
}catch(error){console.error(error instanceof Error&&/^BILLING_[A-Z_]+$/.test(error.message)?error.message:'BILLING_OPERATION_FAILED');process.exitCode=1;}finally{await db.$disconnect();}
