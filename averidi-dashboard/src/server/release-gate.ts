/**
 * Deployment and release are independent. No external subscription, website
 * identity, or Analyst state can implicitly enable the Dashboard.
 */
export type DashboardReleaseMode = "OFF" | "BETA" | "GENERAL";
export type DashboardReleaseConfig = Readonly<{mode:DashboardReleaseMode;betaWorkspaceIds:ReadonlySet<string>}>;

export function dashboardReleaseConfig(env:Partial<NodeJS.ProcessEnv>=process.env): DashboardReleaseConfig {
  const mode=env.DASHBOARD_RELEASE_MODE??"OFF";
  if(!["OFF","BETA","GENERAL"].includes(mode))throw new Error("Invalid Dashboard release mode");
  const raw=env.DASHBOARD_BETA_WORKSPACE_IDS??"";
  const ids=raw.split(",").map(x=>x.trim()).filter(Boolean);
  if(ids.some(x=>!/^[A-Za-z0-9_-]{1,128}$/.test(x)) || new Set(ids).size!==ids.length)
    throw new Error("Invalid Dashboard beta workspace allowlist");
  return {mode:mode as DashboardReleaseMode,betaWorkspaceIds:new Set(ids)};
}

export function isDashboardWorkspaceReleased(workspaceId:string,config:DashboardReleaseConfig):boolean {
  if(!workspaceId)return false;
  if(config.mode==="OFF")return false;
  if(config.mode==="GENERAL")return true;
  return config.betaWorkspaceIds.has(workspaceId);
}
