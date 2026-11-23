import {assertProviderConfigured,type ConnectorProvider} from "../connectors/contracts";
import {dashboardDb} from "../../server/db";
import {requireWorkspaceRole,type VerifiedDashboardActor} from "../../server/workspace-access";
import {dashboardSourceCapability,dashboardSourceHealth,DASHBOARD_SOURCE_CATALOG} from "./catalog";

export async function listWorkspaceDataSources(actor:VerifiedDashboardActor,workspaceId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,"VIEWER"))return null;
 const sources=await dashboardDb.dashboardDataSource.findMany({
  where:{workspaceId},
  select:{id:true,kind:true,name:true,status:true,lastCheckedAt:true,lastSyncedAt:true,lastErrorCode:true,_count:{select:{datasets:true}}},
  orderBy:{createdAt:"desc"},take:100,
 });
 return sources.map(({_count,...source})=>({
  ...source,status:dashboardSourceHealth(source.status),capability:dashboardSourceCapability(source.kind),datasetCount:_count.datasets,
 }));
}
export function dashboardSourceCatalogForCustomers(){
 return Object.entries(DASHBOARD_SOURCE_CATALOG).map(([kind,entry])=>{let configured=kind==='FILE';if(!configured)try{assertProviderConfigured(kind as ConnectorProvider);configured=true;}catch{}return {kind,...entry,configured};});
}
