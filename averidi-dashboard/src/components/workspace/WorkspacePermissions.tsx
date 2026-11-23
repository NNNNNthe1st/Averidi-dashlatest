'use client';
import {createContext,useContext,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {basePermissions,pagePermission,type WorkspacePermission} from '../../features/permissions/catalog';
type Policy={role:string;restricted:boolean;permissions:WorkspacePermission[]};
const SalesChromeContext=createContext<(hidden:boolean)=>void>(()=>{});
export function useSalesWorkspaceChrome(){return useContext(SalesChromeContext);}
const RoleContext=createContext<Policy>({role:'VIEWER',restricted:false,permissions:basePermissions('VIEWER')});
export function WorkspacePermissions({role,policy,children,navigation}:{role:string;policy?:Policy|null;children:ReactNode;navigation?:ReactNode}){
 const [salesChrome,setSalesChrome]=useState(false);
 const pathname=usePathname(),current=policy??{role,restricted:false,permissions:basePermissions(role)},page=pathname?.split('/workspaces/')[1]?.split('/')[1]??'',read=pagePermission(page);
 const finishedView=/\/workspaces\/[^/]+\/views\/[^/]+\/?$/.test(pathname??'');
 return <SalesChromeContext.Provider value={setSalesChrome}><RoleContext.Provider value={current}>{finishedView&&salesChrome?null:navigation}{current.restricted&&read&&!current.permissions.includes(read)?<main style={{padding:24}}><h1>Workspace permission required</h1><p>Your custom role does not allow this page. Contact a workspace owner.</p><a href="/dashboard/app/workspaces">Choose a workspace</a></main>:children}</RoleContext.Provider></SalesChromeContext.Provider>;
}
export function useWorkspacePermission(permission:WorkspacePermission){const policy=useContext(RoleContext);return policy.permissions.includes(permission);}
export function useWorkspaceRole(){const policy=useContext(RoleContext),pathname=usePathname(),page=pathname?.split('/workspaces/')[1]?.split('/')[1]??'',write=pagePermission(page,true);return policy.role==='EDITOR'&&policy.restricted&&write&&!policy.permissions.includes(write)?'VIEWER':policy.role;}

export function useCustomPermission(permission:WorkspacePermission){const policy=useContext(RoleContext);return !policy.restricted||policy.permissions.includes(permission);}
