'use client';
import Link from 'next/link';
import {dashboardAuthenticatedFetch} from '../../../lib/dashboard-authenticated-fetch';
import {useParams} from 'next/navigation';
import {useEffect,useState} from 'react';
import {useWorkspacePermission} from '../../../components/workspace/WorkspacePermissions';
type View={id:string;name:string;datasetId?:string;updatedAt:string;definition?:{template?:string;widgets?:{kind:string;title:string}[]}};
export default function WorkspaceHome(){
 const {workspaceId}=useParams<{workspaceId:string}>();
 const [views,setViews]=useState<View[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const canCreate=useWorkspacePermission('views.manage'),canUpload=useWorkspacePermission('datasets.write');
 const root='/dashboard/app/api/workspaces/'+encodeURIComponent(workspaceId),pageRoot='/workspaces/'+encodeURIComponent(workspaceId);
 useEffect(()=>{
  let active=true;
  dashboardAuthenticatedFetch(root+'/views',{credentials:'same-origin',cache:'no-store'})
   .then(async r=>{if(!r.ok)throw Error(r.status===402?'An active Dashboard subscription is needed to open saved dashboards.':r.status===403?'You do not have permission to open dashboards.':r.status===401?'Please sign in again.':'Your dashboards could not be loaded.');return r.json() as Promise<{views:View[]}>;})
   .then(data=>{if(active){setViews(data.views);setError('');}})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load dashboards.');})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false};
 },[root,retry]);
 return <main className="av-page" style={{minHeight:'65vh'}}>
   <header className="av-page-header">
     <div><h1>My Dashboards</h1><p>Open your dashboards to see your business performance, or create a new one.</p></div>
     {canUpload?<Link href={pageRoot+'/studio?section=data'} className="av-button-primary">Upload data</Link>:null}
     {canCreate?<Link href={pageRoot+'/studio?create=1'} className="av-button-primary">Create a dashboard</Link>:null}
   </header>
   {loading?<section className="av-card" role="status" aria-live="polite"><h2>Loading your dashboards</h2><p>We’re retrieving your saved dashboards and checking access.</p></section>:null}
   {error?<section className="av-card" role="alert"><h2>Dashboards could not be loaded</h2><p>{error}</p><button type="button" onClick={()=>{setError('');setLoading(true);setRetry(value=>value+1);}}>Try again</button></section>:null}
   {!loading&&!error&&views.length===0?<section className="av-card">
     <h2>No dashboards yet</h2><p>Choose the dashboard you'd like to build, then upload or select the necessary data.</p>
     {canCreate?<Link className="av-button-primary" href={pageRoot+'/studio?create=1'}>Create my first dashboard</Link>:<p>Ask a workspace editor to create and share a dashboard with you.</p>}
     </section>:null}
   {!loading&&!error&&views.length>0?<><p role="status">{views.length} saved dashboard{views.length===1?'':'s'} available to you. Choose a dashboard to view your results.</p><section aria-label="Saved dashboards" className="av-card-grid">
     {views.map(view=><article key={view.id} className="av-card">
       <h2 style={{fontSize:20}}>{view.name}</h2><p>{view.definition?.template?view.definition.template.toLowerCase().replaceAll('_',' ')+' dashboard · ':''}{view.definition?.widgets?.length??0} chart or metric widget(s)</p><p style={{color:'#526779',fontSize:14}}>Last saved: {new Date(view.updatedAt).toLocaleDateString()}</p>
       <Link href={pageRoot+'/views/'+encodeURIComponent(view.id)} style={{display:'inline-block',marginTop:8,color:'#174f76',fontWeight:700}}>View dashboard</Link>{view.definition?.template==='SALES'&&canUpload?<Link href={pageRoot+'/studio?sales=1&view='+encodeURIComponent(view.id)} style={{display:'inline-block',marginLeft:16,fontWeight:700}}>Update Sales data</Link>:null}
     </article>)}
   </section></>:null}
 </main>;
}
