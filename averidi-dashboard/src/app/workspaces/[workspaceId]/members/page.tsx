"use client";
import {useEffect,useState} from "react";
import {useParams} from "next/navigation";

type Member={userId:string;role:"OWNER"|"EDITOR"|"VIEWER"};
type Invitation={id:string;role:string;expiresAt:string;revokedAt:string|null;acceptedAt:string|null};

export default function WorkspacePeoplePage(){
 const {workspaceId}=useParams<{workspaceId:string}>();
 const root="/dashboard/app/api/workspaces/"+encodeURIComponent(workspaceId);
 const [members,setMembers]=useState<Member[]>([]);
 const [invites,setInvites]=useState<Invitation[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const [role,setRole]=useState<"EDITOR"|"VIEWER">("VIEWER");
 const [issuedToken,setIssuedToken]=useState("");
 async function refresh(){
  const [people,invitations]=await Promise.all([
   fetch(root+"/members",{credentials:"same-origin",cache:"no-store"}),
   fetch(root+"/invitations",{credentials:"same-origin",cache:"no-store"})
  ]);
  if(!people.ok||!invitations.ok)throw new Error(people.status===403||invitations.status===403?"Only workspace owners can manage members and invitations.":"Unable to load workspace access.");
  const p:{members:Member[]}=await people.json();
  const i:{invitations:Invitation[]}=await invitations.json();
  setMembers(p.members);setInvites(i.invitations);
 }
 useEffect(()=>{
  let active=true;
  Promise.all([fetch(root+"/members",{credentials:"same-origin",cache:"no-store"}),fetch(root+"/invitations",{credentials:"same-origin",cache:"no-store"})])
   .then(async([people,invitations])=>{
    if(!people.ok||!invitations.ok)throw new Error(people.status===403||invitations.status===403?"Only workspace owners can manage members and invitations.":"Unable to load workspace access.");
    return {people:(await people.json()) as {members:Member[]},invitations:(await invitations.json()) as {invitations:Invitation[]}};
   }).then(data=>{if(active){setMembers(data.people.members);setInvites(data.invitations.invitations);}})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:"Unable to load members.");})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false};
 },[root]);
 async function request(path:string,method:"POST"|"PATCH"|"DELETE",body?:object){
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch(root+path,{method,credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
   const result:Record<string,unknown>=await response.json();
   if(!response.ok)throw new Error(response.status===409?"The membership changed. Reload and try again.":typeof result.error==="string"?result.error:"Unable to update workspace.");
   if(path==="/invitations"&&typeof result.token==="string")setIssuedToken(result.token);
   await refresh();
   setNotice("Workspace access updated.");
  }catch(e){setError(e instanceof Error?e.message:"Workspace update failed.");}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:880,margin:"40px auto",padding:20,fontFamily:"system-ui"}}>
  <p><a href={"/dashboard/app/workspaces/"+encodeURIComponent(workspaceId)+"/studio"}>Back to Studio</a></p>
  <h1>Workspace members and invitations</h1>
  <p>Only workspace owners can manage access. Invitation tokens are displayed once and expire after seven days.</p>
  {loading?<p role="status">Loading workspace access…</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {notice?<p role="status">{notice}</p>:null}
  {!loading&&!error?<><section><h2>Members</h2><ul>{members.map(member=><li key={member.userId} style={{marginBottom:12}}>
   <code>{member.userId}</code> — {member.role}{" "}
   <select aria-label={"Role for "+member.userId} disabled={busy} value={member.role} onChange={e=>void request("/members/"+encodeURIComponent(member.userId),"PATCH",{role:e.target.value})}>
    {["OWNER","EDITOR","VIEWER"].map(option=><option key={option}>{option}</option>)}
   </select>{" "}
   <button type="button" disabled={busy} onClick={()=>{if(window.confirm("Remove this member from the workspace?"))void request("/members/"+encodeURIComponent(member.userId),"DELETE");}}>Remove</button>
  </li>)}</ul></section>
  <section><h2>Invite a member</h2><label>Role <select value={role} disabled={busy} onChange={e=>setRole(e.target.value as "EDITOR"|"VIEWER")}><option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option></select></label>{" "}
   <button type="button" disabled={busy} onClick={()=>void request("/invitations","POST",{role})}>Create invitation</button>
   {issuedToken?<p role="status">Copy this private invitation token and share it securely. It will not be shown again: <code style={{overflowWrap:"anywhere"}}>{issuedToken}</code> <button type="button" onClick={()=>{void navigator.clipboard.writeText(issuedToken)}}>Copy token</button></p>:null}
  </section>
  <section><h2>Invitations</h2><ul>{invites.map(invite=><li key={invite.id}>{invite.role} — {invite.acceptedAt?"Accepted":invite.revokedAt?"Revoked":new Date(invite.expiresAt).getTime()<Date.now()?"Expired":"Pending"}{" "}{!invite.acceptedAt&&!invite.revokedAt?<button disabled={busy} type="button" onClick={()=>void request("/invitations/"+encodeURIComponent(invite.id),"DELETE")}>Revoke</button>:null}</li>)}</ul></section></>:null}
 </main>;
}
