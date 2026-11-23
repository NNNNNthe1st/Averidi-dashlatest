"use client";
import {useEffect,useState} from "react";
type Workspace={role:string;workspace:{id:string;name:string}};
export default function WorkspaceChooser(){
 const [items,setItems]=useState<Workspace[]>([]);
 const [error,setError]=useState("");
 const [signInNeeded,setSignInNeeded]=useState(false);
 const [createError,setCreateError]=useState("");
 const [inviteError,setInviteError]=useState("");
 const [canCreateWorkspace,setCanCreateWorkspace]=useState(false);
 const [loading,setLoading]=useState(true);
 const [workspaceName,setWorkspaceName]=useState("");
 const [creating,setCreating]=useState(false);
 const [inviteToken,setInviteToken]=useState("");
 const [accepting,setAccepting]=useState(false);
 const [notice,setNotice]=useState("");
 const [showTeamJoin,setShowTeamJoin]=useState(false);
 useEffect(()=>{
  let active=true;
  fetch("/dashboard/app/api/workspaces",{credentials:"same-origin",cache:"no-store"})
   .then(async response=>{if(!response.ok){setSignInNeeded(response.status===401);throw new Error(response.status===401?"Sign in to use Averidi Dashboard.":"Workspace access is unavailable.");}return response.json() as Promise<{workspaces:Workspace[];canCreateWorkspace:boolean}>;})
   .then(data=>{if(!active)return;setError("");setSignInNeeded(false);setItems(data.workspaces);setCanCreateWorkspace(data.canCreateWorkspace);const explicitChooser=new URLSearchParams(window.location.search).get("choose")==="1";if(!explicitChooser&&data.workspaces.length===1)window.location.replace("/dashboard/app/workspaces/"+encodeURIComponent(data.workspaces[0].workspace.id));})
   .catch(err=>{if(active)setError(err instanceof Error?err.message:"Unable to load workspaces.")})
   .finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[]);
 async function createWorkspace(){
  if(creating||workspaceName.trim().length<2)return;
  setCreating(true);setCreateError("");setNotice("");
  try{
   const response=await fetch("/dashboard/app/api/workspaces",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:workspaceName.trim()})});
   if(!response.ok)throw new Error(response.status===401?"Sign in before creating a workspace.":response.status===403?"Workspace creation is not available for this account.":"Unable to create the workspace.");
   const data:{workspace:{id:string;name:string}}=await response.json();
   window.location.assign("/dashboard/app/workspaces/"+encodeURIComponent(data.workspace.id)+"/studio?create=1");
  }catch(error){setCreateError(error instanceof Error?error.message:"Unable to create workspace.");}
  finally{setCreating(false);}
 }
 async function acceptInvitation(){
  if(accepting||!inviteToken.trim())return;
  setAccepting(true);setNotice("");setInviteError("");
  try{
   const response=await fetch("/dashboard/app/api/invitations/accept",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:inviteToken.trim()})});
   if(!response.ok)throw new Error(response.status===401?"Sign in before accepting an invitation.":"This invitation is invalid, expired, revoked or already used.");
   const data:{workspaceId:string}=await response.json();
   window.location.assign("/dashboard/app/workspaces/"+encodeURIComponent(data.workspaceId)+"/studio");
  }catch(error){setInviteError(error instanceof Error?error.message:"Unable to accept the invitation.");}
  finally{setAccepting(false);}
 }
 async function signOut(){
  try{
   const response=await fetch("/dashboard/app/api/auth/logout",{method:"POST",credentials:"same-origin"});
   if(!response.ok)throw new Error("Sign out is unavailable. Please try again.");
   window.location.assign("/dashboard/app/signed-out");
  }catch(error){setError(error instanceof Error?error.message:"Unable to sign out.");}
 }
 return <main className="av-page" style={{maxWidth:720}}>
  <h1>Welcome to Averidi Dashboard</h1>
  <a href="/dashboard/app/settings">Account settings</a>
  <p>Enter your business name to get started. Your dashboards and data will be organized for you automatically.</p><p><a href="/dashboard/app/demo">Explore the sample before uploading a file</a></p>
  {loading?<p role="status" aria-live="polite">Checking your businesses and dashboards…</p>:null}
  {error?<section className="av-card" role="alert"><h2>Unable to open your businesses</h2><p>{error}</p>{signInNeeded?<a className="av-button-primary" href="/dashboard/app/login">Sign in</a>:<button type="button" onClick={()=>window.location.reload()}>Try again</button>}</section>:null}
  {!loading&&!error&&items.length===0?<p>To get started, tell us your business name below.</p>:null}
  <ul>{items.map(item=><li key={item.workspace.id}><a href={"/dashboard/app/workspaces/"+encodeURIComponent(item.workspace.id)}>{item.workspace.name}</a> — {item.role}{item.role==="OWNER"?<> — <a href={"/dashboard/app/workspaces/"+encodeURIComponent(item.workspace.id)+"/members"}>Manage access</a></>:null}</li>)}</ul>
  {!loading&&!error?(canCreateWorkspace?<section className="av-card" aria-label="Business setup" style={{marginTop:24}}><h2>What is your business name?</h2><p>We’ll use it to organize your dashboards. You can change it later.</p><form className="av-form" onSubmit={event=>{event.preventDefault();void createWorkspace();}}><label>Business name <input required minLength={2} maxLength={120} value={workspaceName} onChange={event=>setWorkspaceName(event.target.value)} disabled={creating} /></label> <button type="submit" disabled={creating||workspaceName.trim().length<2}>{creating?"Setting up your business…":"Continue"}</button></form>{createError?<p role="alert">{createError}</p>:null}</section>:<p>Adding a new business is not available right now. You can still open a business you already belong to.</p>):null}
  <details style={{marginTop:24}}><summary>Joining an existing business team?</summary><section aria-label="Join a team" style={{marginTop:24}}><button type="button" aria-expanded={showTeamJoin} onClick={()=>setShowTeamJoin(v=>!v)}>{showTeamJoin?"Hide team invitation":"Joining a team? Open invitation options"}</button>{showTeamJoin?<><h2>Join a business team</h2><form onSubmit={event=>{event.preventDefault();void acceptInvitation();}}><label>Invitation token <input required autoComplete="off" value={inviteToken} onChange={event=>setInviteToken(event.target.value)} disabled={accepting} /></label> <button type="submit" disabled={accepting||!inviteToken.trim()}>{accepting?"Joining…":"Accept invitation"}</button></form>{inviteError?<p role="alert">{inviteError}</p>:null}</>:null}</section></details>
  {notice?<p role="status">{notice}</p>:null}
  <button type="button" onClick={signOut} style={{marginTop:24}}>Sign out</button>
 </main>;
}
