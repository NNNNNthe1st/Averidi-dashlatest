import * as authModule from '../src/server/browser-session.ts';
import * as dbModule from '../src/server/db.ts';
const {cleanupDashboardAuthentication}=authModule.default??authModule;
const {dashboardDb}=dbModule.default??dbModule;
try{console.log(JSON.stringify(await cleanupDashboardAuthentication()));}
finally{await dashboardDb.$disconnect();}
