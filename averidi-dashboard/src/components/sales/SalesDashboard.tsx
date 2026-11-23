'use client';
import {useEffect,useRef} from 'react';
import {useSalesWorkspaceChrome} from '../workspace/WorkspacePermissions';
import {createSalesDashboard} from './sales-dashboard-dom';
import type {SalesDashboardProps} from './contracts';
/** Native DOM controls in an isolated style boundary retain the approved design verbatim. */
export default function SalesDashboard(props:SalesDashboardProps){
 const setSalesChrome=useSalesWorkspaceChrome();
 useEffect(()=>{setSalesChrome(true);return()=>setSalesChrome(false);},[setSalesChrome]);
 const host=useRef<HTMLDivElement>(null);
 const controller=useRef<ReturnType<typeof createSalesDashboard>|null>(null);
 const latest=useRef(props);latest.current=props;
 useEffect(()=>{if(!host.current)return;const root=host.current.shadowRoot??host.current.attachShadow({mode:'open'});controller.current=createSalesDashboard(root);controller.current.update(latest.current);return()=>{controller.current?.dispose();controller.current=null;};},[]);
 useEffect(()=>{controller.current?.update(props);},[props]);
 return <div ref={host} data-sales-dashboard="approved" aria-label="Sales Performance Dashboard"/>;
}
