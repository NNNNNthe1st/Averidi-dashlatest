'use client';
import {useState} from 'react';
import {useParams} from 'next/navigation';
import {dashboardRequest,useDashboardResource,workspaceApi,workspacePageStyle} from '../../../../components/workspace/client';
type Team={id:string;name:string;updatedAt:string;members:{userId:string}[]};
function TeamEditor({team,members,busy,save}:{team:Team;members:{userId:string;role:string}[];busy:boolean;save:(input:unknown)=>void}){
 const [name,setName]=useState(team.name),[selected,setSelected]=useState(team.members.map(m=>m.userId));
 return <section aria-label={team.name} style={{border:'1px solid #ccd4de',padding:16,marginTop:16}}><h2>{team.name}</h2>
  <form onSubmit={e=>{e.preventDefault();save({action:'RENAME',id:team.id,name,expectedUpdatedAt:team.updatedAt});}}><label>Team name <input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label> <button disabled={busy}>Rename team</button></form>
  <form onSubmit={e=>{e.preventDefault();save({action:'MEMBERS',id:team.id,userIds:selected,expectedUpdatedAt:team.updatedAt});}}><fieldset disabled={busy}><legend>Team members</legend>{members.map(m=><label key={m.userId} style={{display:'block',overflowWrap:'anywhere'}}><input type="checkbox" checked={selected.includes(m.userId)} onChange={e=>setSelected(old=>e.target.checked?[...old,m.userId]:old.filter(id=>id!==m.userId))}/>{m.userId} ({m.role})</label>)}</fieldset><button disabled={busy}>Save team members</button></form>
  <button type="button" disabled={busy} onClick={()=>{if(window.confirm('Delete this team? Workspace access stays unchanged.'))save({action:'DELETE',id:team.id,expectedUpdatedAt:team.updatedAt});}}>Delete team</button>
 </section>;
}
export default function TeamsPage(){
 const {workspaceId}=useParams<{workspaceId:string}>(),url=workspaceApi(workspaceId)+'/teams';
 const resource=useDashboardResource<{role:string;teams:Team[];members:{userId:string;role:string}[]}>(url);
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 async function save(input:unknown){setBusy(true);setError('');setNotice('');try{await dashboardRequest(url,{method:'POST',body:JSON.stringify(input)});setName('');setNotice('Team updated.');resource.reload();}catch(e){setError(e instanceof Error?e.message:'Unable to update team.');}finally{setBusy(false);}}
 return <main style={workspacePageStyle}><h1>Teams</h1><p>Teams group existing workspace members. They do not change permissions or grant access. Owners manage workspace roles on Members. Removing workspace access automatically removes team membership.</p>
  {resource.loading?<p role="status">Loading teams…</p>:null}{resource.error||error?<p role="alert">{error||resource.error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {resource.data?.role==='OWNER'?<form onSubmit={e=>{e.preventDefault();void save({action:'CREATE',name});}}><label>New team name <input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label> <button disabled={busy}>Create team</button></form>:null}
  {resource.data&&!resource.data.teams.length?<p>No teams created yet.</p>:null}
  <p>Up to 200 teams and workspace members are shown.</p>
  {resource.data?.teams.map(team=>resource.data?.role==='OWNER'?<TeamEditor key={team.id+team.updatedAt} team={team} members={resource.data.members} busy={busy} save={input=>void save(input)}/>:<section key={team.id}><h2>{team.name}</h2><ul>{team.members.map(m=><li style={{overflowWrap:'anywhere'}} key={m.userId}>{m.userId}</li>)}</ul></section>)}
 </main>;
}
