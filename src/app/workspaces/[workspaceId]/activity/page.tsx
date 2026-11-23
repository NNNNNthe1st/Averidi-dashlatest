'use client';
import {useParams} from 'next/navigation';
import {useWorkspaceRole} from '../../../../components/workspace/WorkspacePermissions';
import AuditHistory from '../../../../components/workspace/AuditHistory';
import {workspaceApi,workspacePageStyle} from '../../../../components/workspace/client';
export default function ActivityPage(){const {workspaceId}=useParams<{workspaceId:string}>(),role=useWorkspaceRole();return <main style={{...workspacePageStyle,overflowWrap:'anywhere',minWidth:0}}><h1>Workspace activity</h1><p>Only workspace Owners can inspect this history.</p>{role==='OWNER'?<AuditHistory url={workspaceApi(workspaceId)+'/activity'}/>:<p>Workspace Owner access is required.</p>}</main>;}
