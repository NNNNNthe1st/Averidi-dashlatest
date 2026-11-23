'use client';
import {useState} from 'react';
import {useParams} from 'next/navigation';
import {dashboardRequest,useDashboardResource,workspaceApi,workspacePageStyle} from '../../../../components/workspace/client';
import ResourceStatus from '../../../../components/workspace/ResourceStatus';
import WorkspacePresentationForm from '../../../../components/workspace/WorkspacePresentationForm';
export default function SettingsPage(){
 const {workspaceId}=useParams<{workspaceId:string}>(),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const resource=useDashboardResource<{workspaces:{role:string;workspace:{id:string;name:string}}[]}>('/dashboard/app/api/workspaces');
 const current=resource.data?.workspaces.find(item=>item.workspace.id===workspaceId);
 async function rename(){setBusy(true);setError('');setNotice('');try{await dashboardRequest(workspaceApi(workspaceId),{method:'PATCH',body:JSON.stringify({name:name.trim()})});setNotice('Workspace name updated.');setName('');resource.reload();}catch(error){setError(error instanceof Error?error.message:'Unable to save.');}finally{setBusy(false);}}
 async function signOut(all:boolean){if(all&&!window.confirm('Sign out of Dashboard on all devices?'))return;setBusy(true);setError('');try{await dashboardRequest('/dashboard/app/api/auth/'+(all?'logout-all':'logout'),{method:'POST'});window.location.assign('/dashboard/app/signed-out');}catch(error){setError(error instanceof Error?error.message:'Unable to sign out.');}finally{setBusy(false);}}
 return <main style={workspacePageStyle}><h1>Workspace settings</h1><ResourceStatus {...resource}/>{current?<><p>Workspace: {current.workspace.name}</p><p>Your role: {current.role}</p>{current.role==='OWNER'?<form onSubmit={event=>{event.preventDefault();void rename();}}><label>New workspace name <input required minLength={2} maxLength={120} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>{' '}<button disabled={busy||name.trim().length<2}>Save workspace name</button></form>:null}</>:null}
 <WorkspacePresentationForm workspaceId={workspaceId} canEdit={current?.role==='OWNER'}/>
 {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}<section><h2>Account security</h2><p><a href="/dashboard/app/settings">Profile and individual session settings</a></p><p>Sign-in details and account recovery are managed by your identity provider.</p><button type="button" disabled={busy} onClick={()=>void signOut(false)}>Sign out</button>{' '}<button type="button" disabled={busy} onClick={()=>void signOut(true)}>Sign out on all devices</button></section></main>;
}
