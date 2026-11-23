/** Dashboard-owned engine manifest. No Analyst imports, clients or shared runtime. */
export const DASHBOARD_ENGINE_VERSION = 1 as const;
export const DASHBOARD_ENGINES = Object.freeze({
 ingestion:{id:"ingestion",version:1,description:"File parsing and normalized tabular input"},
 understanding:{id:"understanding",version:1,description:"Dataset semantics and confirmation boundary"},
 metrics:{id:"metrics",version:1,description:"Governed deterministic KPI calculations"},
 analysis:{id:"analysis",version:1,description:"Version-bound validation and confirmed calculation pipeline"},
 visualization:{id:"visualization",version:1,description:"Governed KPI and grouped chart data"},
 reporting:{id:"reporting",version:1,description:"Calculated metric reports with source lineage"},
 generation:{id:"generation",version:1,description:"Dashboard template and widget configuration"},
} as const);
export type DashboardEngineName=keyof typeof DASHBOARD_ENGINES;
export function dashboardEngineManifest(){
 return {version:DASHBOARD_ENGINE_VERSION,engines:Object.values(DASHBOARD_ENGINES).map(x=>({...x}))};
}
export function requireDashboardEngine(name:string,version:number){
 if(!Object.prototype.hasOwnProperty.call(DASHBOARD_ENGINES,name))throw new Error("Unknown Dashboard engine.");
 const engine=DASHBOARD_ENGINES[name as DashboardEngineName];
 if(engine.version!==version)throw new Error("Unsupported Dashboard engine version.");
 return engine;
}
