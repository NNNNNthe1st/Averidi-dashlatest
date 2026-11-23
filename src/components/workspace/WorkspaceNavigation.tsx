'use client';
import {dashboardAuthenticatedFetch} from '../../lib/dashboard-authenticated-fetch';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import styles from './WorkspaceNavigation.module.css';
import {basePermissions,type WorkspacePermission} from '../../features/permissions/catalog';

const linkStyle={display:'inline-block',padding:'9px 11px',borderRadius:8} as const;
export default function WorkspaceNavigation({workspaceId,role,permissions}:{workspaceId:string;role:string;permissions?:WorkspacePermission[]}) {
 const pathname=usePathname();
 const isFinishedView=/\/workspaces\/[^/]+\/views\/[^/]+\/?$/.test(pathname??'');
 const allowed=permissions??basePermissions(role);
 const has=(permission:WorkspacePermission)=>allowed.includes(permission);
 const canReadMonitoring=has('monitoring.read'),[unread,setUnread]=useState<number|null>(null);
 useEffect(()=>{const controller=new AbortController();let active=true,pending=false;setUnread(null);
  async function load(){if(pending)return;pending=true;try{const r=await dashboardAuthenticatedFetch('/dashboard/app/api/workspaces/'+encodeURIComponent(workspaceId)+'/monitoring/summary',{cache:'no-store',credentials:'same-origin',signal:controller.signal});const value=await r.json();if(active)setUnread(r.ok&&Number.isSafeInteger(value.open)&&value.open>=0?value.open:null);}catch{if(active)setUnread(null);}finally{pending=false;}}
  const changed=()=>void load();if(canReadMonitoring){void load();window.addEventListener('dashboard-monitoring-changed',changed);}const timer=canReadMonitoring?setInterval(()=>void load(),30000):undefined;return()=>{active=false;controller.abort();window.removeEventListener('dashboard-monitoring-changed',changed);if(timer)clearInterval(timer);};
 },[workspaceId,canReadMonitoring]);
 const root='/workspaces/'+encodeURIComponent(workspaceId);
 const advanced=has('analysis.read')||has('datasets.read')||has('connectors.read')||has('jobs.read')||role==='OWNER';
 if(isFinishedView)return null;
 return <nav aria-label="Workspace navigation" className={styles.navigation}>
   <Link style={{...linkStyle,fontWeight:700,color:"#174f76"}} href={root}>My Dashboards</Link>
   {has('datasets.read')?<Link style={linkStyle} href={root+'/data'}>Data</Link>:null}
   {has('analysis.read')?<Link style={linkStyle} href={root+'/studio'}>Create &amp; Edit</Link>:null}
   {has('reports.read')?<Link style={linkStyle} href={root+'/reports'}>Reports</Link>:null}
   {has('monitoring.read')?<Link style={linkStyle} href={root+'/monitoring'}>Alerts {unread?<span id="workspace-alert-count" role="status" aria-live="polite" style={{fontSize:12,fontWeight:700}}>{unread} new</span>:null}</Link>:null}
   {advanced?<details style={{position:'relative',minWidth:160}}>
     <summary style={{cursor:'pointer',padding:9}}>More tools and settings</summary>
     <div className={styles.panel}>
       {has('analysis.read')?<Link href={root+'/metrics'}>Custom metrics</Link>:null}
       {has('datasets.read')?<Link href={root+'/relationships'}>Data relationships</Link>:null}
       {has('connectors.read')?<><Link href={root+'/connectors'}>Connections</Link><Link href={root+'/custom-sources'}>API sources and webhooks</Link></>:null}
       {has('jobs.read')?<Link href={root+'/jobs'}>Jobs and schedules</Link>:null}
       {has('views.read')?<Link href={root+'/sharing'}>Dashboard sharing</Link>:null}
       {has('teams.read')?<Link href={root+'/teams'}>Teams</Link>:null}
       {role==='OWNER'?<><Link href={root+'/members'}>Members</Link><Link href={root+'/billing'}>Billing</Link><Link href={root+'/roles'}>Roles and permissions</Link><Link href={root+'/activity'}>Workspace activity</Link></>:null}
       <Link href={root+'/settings'}>Workspace settings</Link>
       <Link href={root+'/usage'}>Plan usage</Link>
     </div>
   </details>:null}
   <details><summary style={{cursor:'pointer',padding:9}}>Account</summary>
     <div className={styles.panel}>
       <Link href="/workspaces?choose=1">Switch workspace</Link>
       <Link href="/organizations">Organizations</Link>
       <Link href="/settings">Account settings</Link>
       {has('support.read')?<Link href={root+'/support'}>Support</Link>:null}
     </div>
   </details>
 </nav>;
}
