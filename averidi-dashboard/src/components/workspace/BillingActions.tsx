'use client';
import {useWorkspacePresentation} from './WorkspacePresentation';
import {useState} from 'react';
import {dashboardRequest,displayDate,useDashboardResource,workspaceApi} from './client';
import ResourceStatus from './ResourceStatus';
type Options={enabled:boolean;canCheckout:boolean;canManage:boolean;plans:{code:string;name:string;currency:string;amountMinor:number;billingInterval:string}[];pending:null|{planCode:string;planName:string;expiresAt:string;status:string}};
export default function BillingActions({workspaceId,onChange}:{workspaceId:string;onChange:()=>void}){
 const presentation=useWorkspacePresentation();
 const base=workspaceApi(workspaceId)+'/billing',resource=useDashboardResource<Options>(base+'/options'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function action(path:string,method='POST',body:unknown={},navigate=false){setBusy(true);setError('');setNotice('');try{const result=await dashboardRequest<{url?:string|null;status?:string}>(base+path,{method,body:JSON.stringify(body)});if(navigate&&result.url){window.location.assign(result.url);return;}setNotice(result.status==='COMPLETED'?'Checkout verified. Your subscription status is shown below.':'Billing status refreshed from the payment provider.');resource.reload();onChange();}catch(e){setError(e instanceof Error?e.message:'Unable to update billing.');}finally{setBusy(false);}}
 const data=resource.data;
 return <section aria-labelledby="billing-actions-heading"><h2 id="billing-actions-heading">Manage your subscription</h2><ResourceStatus {...resource}/>{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}{data?data.enabled?<>
 <p>Payment and subscription changes are confirmed securely with our payment provider. Returning to this page does not confirm payment. Refresh to check the verified status.</p>
 <button disabled={busy} onClick={()=>action('/refresh')}>Refresh billing status</button>{data.canManage?<button disabled={busy} onClick={()=>action('/portal','POST',{},true)}>Manage plan, cancellation and payment methods</button>:null}
 {data.pending?<div><h3>Pending checkout: {data.pending.planName}</h3><p>Expires {displayDate(data.pending.expiresAt,presentation)}</p><button disabled={busy} onClick={()=>action('/checkout','POST',{planCode:data.pending!.planCode},true)}>Resume secure checkout</button><button disabled={busy} onClick={()=>action('/checkout','DELETE')}>Cancel pending checkout</button></div>:data.canCheckout?<><h3>Available Dashboard plans</h3>{data.plans.length?data.plans.map(plan=><div key={plan.code}><h4>{plan.name}</h4><p>{new Intl.NumberFormat(presentation?.locale??'en-US',{style:'currency',currency:plan.currency}).format(plan.amountMinor/10**new Intl.NumberFormat('en-US',{style:'currency',currency:plan.currency}).resolvedOptions().maximumFractionDigits!)} per {plan.billingInterval}</p><button disabled={busy} onClick={()=>action('/checkout','POST',{planCode:plan.code},true)}>Continue to secure checkout — {plan.name}</button></div>):<p>No plans are currently available for purchase.</p>}</>:null}
 </>:<p>Online subscription management is not enabled in this environment. Contact Dashboard support for assistance.</p>:null}</section>;
}
