'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import {dashboardAuthenticatedFetch} from '../../../../../lib/dashboard-authenticated-fetch';
import {useWorkspacePermission} from '../../../../../components/workspace/WorkspacePermissions';
import DashboardCanvas from '../../../../../components/studio/DashboardCanvas';
import type {DashboardConfig} from '../../../../../engines/generation/dashboard-templates';
import styles from './page.module.css';

type SavedView={id:string;name:string;datasetId:string;updatedAt:string;canEdit?:boolean;definition:DashboardConfig};

/** Finished dashboards have their own viewport, separate from Studio configuration. */
export default function FinishedDashboardPage(){
 const {workspaceId,viewId}=useParams<{workspaceId:string;viewId:string}>();
 const [view,setView]=useState<SavedView|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [revision,setRevision]=useState(0);
 const [,setLayoutDirty]=useState(false);
 const canEdit=useWorkspacePermission('views.manage');
 const workspaceRoot='/workspaces/'+encodeURIComponent(workspaceId);
 useEffect(()=>{
  let active=true;
  setLoading(true);setError('');
  dashboardAuthenticatedFetch('/dashboard/app/api/workspaces/'+encodeURIComponent(workspaceId)+'/views',{credentials:'same-origin',cache:'no-store'})
   .then(async response=>{if(!response.ok)throw Error(response.status===401?'Your session has expired. Sign in and try again.':response.status===403?'You cannot access this workspace.':response.status===402?'An active subscription is required.':'Unable to load this dashboard.');return response.json() as Promise<{views:SavedView[]}>;})
   .then(result=>{if(!active)return;const selected=result.views.find(candidate=>candidate.id===viewId);if(!selected)throw Error('This dashboard is unavailable or you do not have access.');setView(selected);})
   .catch(cause=>{if(active){setView(null);setError(cause instanceof Error?cause.message:'Unable to open this dashboard.');}})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[workspaceId,viewId,revision]);
 return <main className={view?.definition.template==='SALES'?styles.salesPage:styles.page} aria-label="Finished business dashboard">
  {loading?<p role="status">Loading your dashboard…</p>:null}
  {error?<section role="alert" className={styles.message}><p>{error}</p><Link href={workspaceRoot}>Return to dashboards</Link><button type="button" onClick={()=>setRevision(value=>value+1)}>Retry</button></section>:null}
  {!loading&&view?<>{view.definition.template!=='SALES'?<div className={styles.actions}><Link href={workspaceRoot}>All dashboards</Link>{canEdit&&view.canEdit!==false?<Link href={workspaceRoot+'/studio?view='+encodeURIComponent(view.id)}>Edit in Studio</Link>:null}</div>:null}
   <DashboardCanvas key={view.id} workspaceId={workspaceId} viewId={view.id} updatedAt={view.updatedAt} reloadKey={revision} sourceVersionId={null} definition={view.definition} readOnly viewOnly hasUnsavedChanges={false} layoutResetKey={0} onLayoutDirtyChange={setLayoutDirty} onDefinitionChange={()=>{}} onRefreshed={()=>setRevision(value=>value+1)}/>
  </>:null}
 </main>;
}
