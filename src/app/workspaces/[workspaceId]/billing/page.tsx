'use client';
import {useWorkspacePresentation} from '../../../../components/workspace/WorkspacePresentation';
import {useState} from 'react';
import {useParams} from 'next/navigation';
import {displayDate,useDashboardResource,workspaceApi,workspacePageStyle} from '../../../../components/workspace/client';
import BillingActions from '../../../../components/workspace/BillingActions';
import ResourceStatus from '../../../../components/workspace/ResourceStatus';
type Invoice={id:string;currency:string;amount:string;status:string;periodStart:string;periodEnd:string;paidAt:string|null};
type Billing={trial:null|{active:boolean;startedAt:string;expiresAt:string;daysRemaining:number};entitlement:null|{active:boolean;planCode:string|null};subscription:null|{planCode:string;status:string;currentPeriodEnd:string|null;accessSuspended:boolean;billingPlan:null|{name:string;active:boolean;entitlements:unknown}};binding:null|{cancelAtPeriodEnd:boolean;reconciledAt:string|null};invoices:{items:Invoice[];nextCursor:string|null}};
export default function BillingPage(){
 const presentation=useWorkspacePresentation();
 const {workspaceId}=useParams<{workspaceId:string}>(),[cursor,setCursor]=useState('');
 const resource=useDashboardResource<Billing>(workspaceApi(workspaceId)+'/billing?limit=25'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
 const {data}=resource;
 return <main style={workspacePageStyle}><h1>Subscription and invoices</h1><ResourceStatus {...resource}/>{data?<>
 <section><h2>Dashboard subscription</h2>{data.entitlement?.planCode==='TRIAL'&&data.trial?<p role="status">Free trial active · {data.trial.daysRemaining} days remaining · Ends {displayDate(data.trial.expiresAt,presentation)}. You can subscribe at any time without losing your workspace.</p>:data.trial&&!data.trial.active&&!data.entitlement?.active?<p role="status">Your free trial has ended. Subscribe to restore Dashboard access; your workspace remains available.</p>:null}{data.subscription?<dl><dt>Plan</dt><dd>{data.subscription.billingPlan?.name??data.subscription.planCode}</dd><dt>Status</dt><dd>{data.subscription.status}</dd><dt>Current period ends</dt><dd>{displayDate(data.subscription.currentPeriodEnd,presentation)}</dd><dt>Access hold</dt><dd>{data.subscription.accessSuspended?'Active':'None'}</dd><dt>Cancellation at period end</dt><dd>{data.binding?.cancelAtPeriodEnd?'Scheduled':'Not scheduled'}</dd></dl>:<p>No Dashboard subscription is assigned to this workspace.</p>}<p>For subscription changes, <a href={'/dashboard/app/workspaces/'+encodeURIComponent(workspaceId)+'/support'}>contact Dashboard support</a>.</p></section>
 <BillingActions workspaceId={workspaceId} onChange={resource.reload}/><section><h2>Invoices</h2>{data.invoices.items.length===0?<p>No invoices are available.</p>:<div style={{overflowX:'auto'}}><table><caption>Dashboard invoices</caption><thead><tr><th scope="col">Reference</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Period</th><th scope="col">Paid</th></tr></thead><tbody>{data.invoices.items.map(invoice=><tr key={invoice.id}><td>{invoice.id}</td><td>{invoice.currency} {invoice.amount}</td><td>{invoice.status}</td><td>{displayDate(invoice.periodStart,presentation)} – {displayDate(invoice.periodEnd,presentation)}</td><td>{displayDate(invoice.paidAt,presentation)}</td></tr>)}</tbody></table></div>}{cursor?<button onClick={()=>setCursor('')}>First page</button>:null}{data.invoices.nextCursor?<button onClick={()=>setCursor(data.invoices.nextCursor!)}>Next page</button>:null}</section></>:null}</main>;
}
