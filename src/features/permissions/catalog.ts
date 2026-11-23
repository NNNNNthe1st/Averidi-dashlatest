export const permissionCatalog=[
 ['workspace.read','Open the workspace','VIEWER'],['datasets.read','Read dataset profiles and source records','VIEWER'],['datasets.write','Upload, transform and restore datasets','EDITOR'],
 ['analysis.read','Read governed analysis','VIEWER'],['analysis.manage','Confirm field meanings/business rules and calculate analysis','EDITOR'],
 ['views.read','Read dashboards and saved filters','VIEWER'],['views.manage','Create and edit dashboards','EDITOR'],['views.export','Download dashboard definitions and metric CSV files','VIEWER'],
 ['reports.read','Read reports and the delivery inbox','VIEWER'],['reports.manage','Create, generate and deliver reports','EDITOR'],['reports.export','Download generated report files','VIEWER'],
 ['jobs.read','Inspect background jobs','VIEWER'],['jobs.manage','Queue, cancel and schedule background work','EDITOR'],
 ['monitoring.read','Read targets, alert rules and events','VIEWER'],['monitoring.manage','Manage targets, alert rules and acknowledgements','EDITOR'],
 ['connectors.read','Read connection status and configuration','VIEWER'],['connectors.manage','Configure, authorize, refresh and disconnect connections','EDITOR'],
 ['support.read','Read your support cases','VIEWER'],['support.create','Create support cases','VIEWER'],['teams.read','Read workspace teams','VIEWER'],
] as const;
export type WorkspacePermission=typeof permissionCatalog[number][0];
export const permissionKeys=permissionCatalog.map(row=>row[0]);
export function basePermissions(role:string):WorkspacePermission[]{return permissionCatalog.filter(row=>role==='OWNER'||role==='EDITOR'||role==='VIEWER'&&row[2]==='VIEWER').map(row=>row[0]);}
export function pagePermission(page:string,write=false):WorkspacePermission|null{
 if(page==='studio'||page==='metrics')return write?'analysis.manage':'analysis.read';
 if(page==='data'||page==='relationships')return write?'datasets.write':'datasets.read';
 if(page==='monitoring')return write?'monitoring.manage':'monitoring.read';
 if(page==='connectors'||page==='custom-sources')return write?'connectors.manage':'connectors.read';
 if(page==='jobs')return write?'jobs.manage':'jobs.read';
 if(page==='reports')return write?'reports.manage':'reports.read';
 if(page==='views'||page==='sharing')return write?'views.manage':'views.read';
 if(page==='support')return write?'support.create':'support.read';
 if(page==='teams')return 'teams.read';return 'workspace.read';
}
export function jobPermission(kind:string):WorkspacePermission|'owner'{
 if(['DATASET_PROFILE','DATASET_INGEST','DATASET_VALIDATE','DATASET_TRANSFORM','DATASET_JOIN'].includes(kind))return 'datasets.write';
 if(['DATASET_ANALYZE','METRICS_CALCULATE'].includes(kind))return 'analysis.manage';
 if(kind==='DASHBOARD_GENERATE')return 'views.manage';
 if(['REPORT_GENERATE','REPORT_DELIVER'].includes(kind))return 'reports.manage';
 if(kind==='ALERTS_EVALUATE')return 'monitoring.manage';
 if(kind==='SOURCE_REFRESH')return 'connectors.manage';
 return 'owner';
}
const coreRead:WorkspacePermission[]=['datasets.read','analysis.read','views.read'];
export function prerequisites(key:WorkspacePermission):WorkspacePermission[]{
 if(key==='reports.read')return ['views.read'];
 if(key==='reports.manage')return ['reports.read','jobs.manage'];
 if(coreRead.includes(key)||['datasets.write','analysis.manage','views.manage','views.export'].includes(key))return coreRead.filter(p=>p!==key);
 const read=key.endsWith('.manage')||key.endsWith('.export')?key.split('.')[0]+'.read':key==='support.create'?'support.read':null;
 return read&&permissionKeys.includes(read as WorkspacePermission)?[read as WorkspacePermission]:[];
}
export function validPermissionSet(values:readonly string[]){return values.includes('workspace.read')&&new Set(values).size===values.length&&values.every(p=>permissionKeys.includes(p as WorkspacePermission)&&prerequisites(p as WorkspacePermission).every(required=>values.includes(required)));}
export function changePermission(values:WorkspacePermission[],key:WorkspacePermission,enabled:boolean){
 let result=enabled?[...new Set([...values,key])]:values.filter(p=>p!==key);let changed=true;
 while(changed){const previous=result.join();if(enabled)result=[...new Set(result.flatMap(p=>[p,...prerequisites(p)]))];else result=result.filter(p=>prerequisites(p).every(required=>result.includes(required)));changed=previous!==result.join();}
 return [...new Set(['workspace.read' as const,...result])];
}
