'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {dashboardRequest,useDashboardResource,workspaceApi} from './client';
import ResourceStatus from './ResourceStatus';
import type {WorkspacePresentation} from '../../features/workspaces/presentation-contracts';
type Settings={presentation:WorkspacePresentation|null;revision:number};
export default function WorkspacePresentationForm({workspaceId,canEdit}:{workspaceId:string;canEdit:boolean}){
 const api=workspaceApi(workspaceId)+'/presentation',resource=useDashboardResource<Settings>(api),router=useRouter();
 const [currency,setCurrency]=useState(''),[timezone,setTimezone]=useState(''),[locale,setLocale]=useState('en-US'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{if(resource.data){setCurrency(resource.data.presentation?.currency??'');setTimezone(resource.data.presentation?.timezone??'');setLocale(resource.data.presentation?.locale??'en-US');}},[resource.data]);
 async function save(){if(!resource.data)return;setBusy(true);setError('');setNotice('');try{await dashboardRequest(api,{method:'PUT',body:JSON.stringify({presentation:{currency:currency.trim().toUpperCase(),timezone:timezone.trim(),locale:locale.trim()},expectedRevision:resource.data.revision})});setNotice('Business currency, timezone and display format saved.');resource.reload();router.refresh();}catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}}
 return <section aria-label="Business reporting preferences"><h2>Business currency, timezone and display format</h2><ResourceStatus {...resource}/>{resource.data&&!resource.data.presentation?<p>These workspace preferences have not been configured. Existing dataset rules remain authoritative.</p>:null}<p>Currency and timezone are defaults for new confirmations. Review them against each dataset. Changing these preferences does not convert currency, rewrite existing rules or recalculate saved results. The display locale changes dates and numbers; the interface stays in English.</p>
 <form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={!canEdit||busy||resource.loading}><legend>Reporting preferences</legend>
 <p><label>Primary business currency <input aria-label="Primary business currency" required maxLength={3} placeholder="USD" value={currency} onChange={e=>setCurrency(e.target.value)}/></label></p>
 <p><label>Business reporting timezone <input aria-label="Business reporting timezone" required maxLength={100} placeholder="America/New_York" value={timezone} onChange={e=>setTimezone(e.target.value)}/></label></p>
 <p><label>Date and number locale <input aria-label="Date and number locale" required maxLength={80} placeholder="en-US" value={locale} onChange={e=>setLocale(e.target.value)}/></label></p>
 <p>Examples: en-US, en-GB or en-KE. Use a named timezone such as America/New_York, Africa/Nairobi, Asia/Tokyo or UTC.</p>
 <button type="submit">Save reporting preferences</button></fieldset></form>{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}</section>;
}
