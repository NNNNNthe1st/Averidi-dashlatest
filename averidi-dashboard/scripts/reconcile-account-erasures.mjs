import * as service from '../src/features/account-erasure/reconcile.ts';
import * as database from '../src/server/db.ts';
const {reconcileErasureLedger}=service.default??service,{dashboardDb}=database.default??database;
try{console.log(JSON.stringify(await reconcileErasureLedger()));}finally{await dashboardDb.$disconnect();}
