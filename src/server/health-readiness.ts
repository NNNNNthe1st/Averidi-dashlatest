import {erasureSettings} from '../features/account-erasure/contracts';
import {billingConfig} from "../features/billing/contracts";
import {requiredWorkerCapabilities} from "../worker/contracts";
import {queryCacheSettings} from '../features/analysis/cache-contracts';
import {dashboardObjectConfig} from "./object-storage";
import {requireDashboardStorageRoot} from "./data-boundary";
import {dashboardReleaseConfig} from "./release-gate";

export type DashboardReadiness = Readonly<{
 product:"averidi-dashboard";ready:boolean;releaseMode:"OFF"|"BETA"|"GENERAL";
 checks:Readonly<{database:boolean;storage:boolean;worker:boolean;billing:boolean}>;
}>;

/** Dependency readiness is separate from customer release enablement. */
export async function checkDashboardReadiness(
 env:Partial<NodeJS.ProcessEnv>=process.env,
 dependencies:{
  database:()=>Promise<unknown>;
  worker:()=>Promise<number>;
 }={
  database:async()=>{const {dashboardDb}=await import("./db");return dashboardDb.$queryRaw`SELECT 1`;},
  worker:async()=>{const {dashboardDb}=await import("./db");return dashboardDb.dashboardWorkerHeartbeat.count({where:{stopping:false,version:{gte:2},capabilities:{hasEvery:requiredWorkerCapabilities(env)},seenAt:{gt:new Date(Date.now()-30_000)}}});}
 }
):Promise<DashboardReadiness>{
 let releaseMode:"OFF"|"BETA"|"GENERAL"="OFF";
 let configValid=true;
 try{releaseMode=dashboardReleaseConfig(env).mode;}catch{configValid=false;}
 let storage=false;
 try{
  if(env.DASHBOARD_STORAGE_BACKEND==="object") dashboardObjectConfig(env);
  else if(!env.DASHBOARD_STORAGE_BACKEND||env.DASHBOARD_STORAGE_BACKEND==="local") requireDashboardStorageRoot(env.DASHBOARD_STORAGE_ROOT);
  else throw new Error("Unsupported Dashboard storage backend");
  storage=true;
 }catch{storage=false;}
 const [database,worker]=await Promise.all([
  dependencies.database().then(()=>true,()=>false),
  env.DASHBOARD_WORKER_ENABLED==="true"?dependencies.worker().then(n=>n>0,()=>false):Promise.resolve(true)
 ]);
 let billing=true;
 try{if(env.DASHBOARD_BILLING_ENABLED==="true")billingConfig(env);else if(env.DASHBOARD_BILLING_ENABLED&&!(["false"].includes(env.DASHBOARD_BILLING_ENABLED)))billing=false;}catch{billing=false;}
 try{if(erasureSettings(env)&&env.DASHBOARD_WORKER_ENABLED!=='true')configValid=false;}catch{configValid=false;}
 try{queryCacheSettings(env);}catch{configValid=false;}
 const ready=database&&storage&&worker&&billing&&configValid;
 return {product:"averidi-dashboard",ready,releaseMode,checks:{database,storage,worker,billing}};
}
