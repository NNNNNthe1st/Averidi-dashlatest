import {workspaceDashboardEntitlement,workspaceDashboardTrial} from '../../../features/subscriptions/entitlements';
import Link from 'next/link';
import {workspacePolicy} from '../../../features/permissions/policy';
import type {ReactNode} from 'react';
import {headers} from 'next/headers';
import {getAuthenticatedDashboardActor} from '../../../server/auth-boundary';
import {requireWorkspaceRole} from '../../../server/workspace-access';
import WorkspaceNavigation from '../../../components/workspace/WorkspaceNavigation';
import {WorkspacePermissions} from '../../../components/workspace/WorkspacePermissions';
import {WorkspacePresentation} from '../../../components/workspace/WorkspacePresentation';
import {readWorkspacePresentation} from '../../../features/workspaces/presentation';

export const dynamic='force-dynamic';
export default async function WorkspaceLayout({children,params}:{children:ReactNode;params:Promise<{workspaceId:string}>}) {
 const request=new Request('https://dashboard.internal/',{headers:new Headers(await headers())});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return <main style={{padding:24}}><h1>Sign in to Dashboard</h1><Link href="/login">Sign in to Dashboard</Link></main>;
 const {workspaceId}=await params;
 const membership=await requireWorkspaceRole(actor,workspaceId,'VIEWER');
 if(!membership)return <main style={{padding:24}}><h1>Workspace unavailable</h1><Link href="/workspaces">Back to your business</Link></main>;
 const [policy,entitlement,trial]=await Promise.all([workspacePolicy(actor.userId,workspaceId),workspaceDashboardEntitlement(actor,workspaceId),workspaceDashboardTrial(actor,workspaceId)]);
 const presentation=policy?.permissions.includes('workspace.read')?await readWorkspacePresentation(actor,workspaceId):{presentation:null};
 return <WorkspacePresentation value={presentation.presentation}><WorkspacePermissions policy={policy} role={membership.role} navigation={<><WorkspaceNavigation workspaceId={workspaceId} role={membership.role} permissions={policy?.permissions}/>{entitlement?.planCode==='TRIAL'&&trial?.active?<div role="status" style={{padding:'10px 20px',background:'#edf5ff',color:'#172d4b'}}>Free Dashboard trial · {trial.daysRemaining} day{trial.daysRemaining===1?'':'s'} remaining · Ends {new Date(trial.expiresAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'})}. {membership.role==='OWNER'?<Link href={'/workspaces/'+encodeURIComponent(workspaceId)+'/billing'}>View subscription options</Link>:null}</div>:!entitlement?.active?<div role="status" style={{padding:'10px 20px'}}>Dashboard access requires an active subscription. {membership.role==='OWNER'?<Link href={'/workspaces/'+encodeURIComponent(workspaceId)+'/billing'}>View billing</Link>:null}</div>:null}</>}>{children}</WorkspacePermissions></WorkspacePresentation>;
}
