import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {createActorWorkspace,listActorWorkspaces,removeWorkspaceMember,changeWorkspaceMemberRole} from "../src/features/workspaces/service";
import {createWorkspaceInvitation,acceptWorkspaceInvitation,revokeWorkspaceInvitation} from "../src/features/workspaces/invitations";

test("workspaces isolate members, invite once and preserve the last owner",async()=>{
 const suffix=randomUUID();
 const users=await Promise.all(["owner","invitee","outsider"].map(x=>dashboardDb.dashboardUser.create({data:{externalSubject:"test|"+x+"|"+suffix}})));
 const actors=users.map(u=>({userId:u.id,issuer:"test",subject:suffix}));
 let workspaceId="";
 try{
  const result=await createActorWorkspace(actors[0],{name:"Acme"});
  assert.equal(result.ok,true);
  if(!result.ok)throw Error("workspace create failed");
  workspaceId=result.workspace.id;
  assert.equal((await listActorWorkspaces(actors[1])).length,0);
  assert.equal((await createWorkspaceInvitation(actors[2],workspaceId,"EDITOR")).ok,false);
  const invite=await createWorkspaceInvitation(actors[0],workspaceId,"EDITOR");
  assert.equal(invite.ok,true);
  if(!invite.ok)throw Error("invitation creation failed");
  assert.equal((await acceptWorkspaceInvitation(actors[1],invite.token)).ok,true);
  assert.equal((await acceptWorkspaceInvitation(actors[2],invite.token)).ok,false);
  assert.equal((await listActorWorkspaces(actors[1])).length,1);
  assert.equal((await removeWorkspaceMember(actors[1],workspaceId,actors[0].userId)).ok,false);
  assert.equal((await changeWorkspaceMemberRole(actors[0],workspaceId,actors[0].userId,"VIEWER")).ok,false);
  assert.equal((await removeWorkspaceMember(actors[0],workspaceId,actors[1].userId)).ok,true);
  assert.equal((await listActorWorkspaces(actors[1])).length,0);
  const other=await createWorkspaceInvitation(actors[0],workspaceId,"VIEWER");
  if(!other.ok)throw Error("invitation creation failed");
  assert.equal((await revokeWorkspaceInvitation(actors[0],workspaceId,other.invitation.id)).ok,true);
  assert.equal((await acceptWorkspaceInvitation(actors[1],other.token)).ok,false);
 }finally{
  if(workspaceId)await dashboardDb.dashboardWorkspace.delete({where:{id:workspaceId}});
  await Promise.all(users.map(u=>dashboardDb.dashboardUser.delete({where:{id:u.id}})));
 }
});


test("concurrent owner demotions never leave a workspace ownerless",async()=>{
 const suffix=randomUUID();
 const users=await Promise.all(["a","b"].map(x=>dashboardDb.dashboardUser.create({data:{externalSubject:"race|"+x+"|"+suffix}})));
 const actors=users.map(u=>({userId:u.id,issuer:"race",subject:suffix}));
 let workspaceId="";
 try{
  const created=await createActorWorkspace(actors[0],{name:"Concurrency test"});
  assert.equal(created.ok,true);
  if(!created.ok)throw Error("Workspace creation failed.");
  workspaceId=created.workspace.id;
  const invite=await createWorkspaceInvitation(actors[0],workspaceId,"EDITOR");
  assert.equal(invite.ok,true);
  if(!invite.ok)throw Error("Invitation creation failed.");
  assert.equal((await acceptWorkspaceInvitation(actors[1],invite.token)).ok,true);
  assert.equal((await changeWorkspaceMemberRole(actors[0],workspaceId,actors[1].userId,"OWNER")).ok,true);
  const outcomes=await Promise.allSettled([
    changeWorkspaceMemberRole(actors[0],workspaceId,actors[0].userId,"VIEWER"),
    changeWorkspaceMemberRole(actors[1],workspaceId,actors[1].userId,"VIEWER"),
  ]);
  assert.ok(outcomes.every(outcome=>outcome.status==="fulfilled"),"Expected handled serialization conflicts.");
  const owners=await dashboardDb.dashboardMembership.count({where:{workspaceId,role:"OWNER"}});
  assert.ok(owners>=1,"At least one OWNER must remain after simultaneous demotions.");
  assert.ok(outcomes.some(outcome=>outcome.status==="fulfilled"&&!outcome.value.ok));
 }finally{
  if(workspaceId)await dashboardDb.dashboardWorkspace.delete({where:{id:workspaceId}});
  await Promise.all(users.map(u=>dashboardDb.dashboardUser.delete({where:{id:u.id}})));
 }
});

test("cross-workspace actors cannot change membership or issue invitations",async()=>{
 const suffix=randomUUID();
 const users=await Promise.all(["a","b"].map(x=>dashboardDb.dashboardUser.create({data:{externalSubject:"scope|"+x+"|"+suffix}})));
 const actors=users.map(u=>({userId:u.id,issuer:"scope",subject:suffix}));
 const created=await Promise.all(actors.map(actor=>createActorWorkspace(actor,{name:"Isolation "+suffix.slice(0,8)})));
 const ids=created.map(result=>{if(!result.ok)throw Error("Workspace creation failed.");return result.workspace.id;});
 try{
  assert.equal((await createWorkspaceInvitation(actors[1],ids[0],"EDITOR")).ok,false);
  assert.equal((await changeWorkspaceMemberRole(actors[1],ids[0],actors[0].userId,"VIEWER")).ok,false);
  assert.equal((await removeWorkspaceMember(actors[1],ids[0],actors[0].userId)).ok,false);
  assert.equal((await listActorWorkspaces(actors[0])).some(x=>x.workspace.id===ids[1]),false);
  assert.equal((await listActorWorkspaces(actors[1])).some(x=>x.workspace.id===ids[0]),false);
 }finally{
  await Promise.all(ids.map(id=>dashboardDb.dashboardWorkspace.delete({where:{id}})));
  await Promise.all(users.map(u=>dashboardDb.dashboardUser.delete({where:{id:u.id}})));
 }
});
