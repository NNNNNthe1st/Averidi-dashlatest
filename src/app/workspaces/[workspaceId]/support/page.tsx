'use client';
import {useWorkspacePresentation} from '../../../../components/workspace/WorkspacePresentation';
import {useState} from 'react';
import {useParams} from 'next/navigation';
import {dashboardRequest,displayDate,useDashboardResource,workspaceApi,workspacePageStyle} from '../../../../components/workspace/client';
import ResourceStatus from '../../../../components/workspace/ResourceStatus';
type Case={id:string;subject:string;status:string;createdAt:string;updatedAt:string};
export default function SupportPage(){
 const presentation=useWorkspacePresentation();
 const {workspaceId}=useParams<{workspaceId:string}>(),[cursor,setCursor]=useState(''),[subject,setSubject]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const resource=useDashboardResource<{items:Case[];nextCursor:string|null}>(workspaceApi(workspaceId)+'/support?limit=25'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
 async function submit(){setBusy(true);setError('');setNotice('');try{const result=await dashboardRequest<{supportCase:{id:string}}>(workspaceApi(workspaceId)+'/support',{method:'POST',body:JSON.stringify({subject,message})});setSubject('');setMessage('');setNotice('Support request submitted. Reference: '+result.supportCase.id);setCursor('');resource.reload();}catch(error){setError(error instanceof Error?error.message:'Unable to submit the request.');}finally{setBusy(false);}}
 return <main style={workspacePageStyle}><h1>Dashboard support</h1><p>Send a question about this workspace. Only your own requests appear here.</p>
 <form onSubmit={event=>{event.preventDefault();void submit();}}><fieldset disabled={busy}><legend>New support request</legend><p><label>Subject <input required minLength={4} maxLength={160} value={subject} onChange={event=>setSubject(event.target.value)}/></label></p><p><label>Message <textarea required minLength={8} maxLength={4000} rows={6} style={{display:'block',width:'100%',boxSizing:'border-box'}} value={message} onChange={event=>setMessage(event.target.value)}/></label></p><button type="submit">{busy?'Sending…':'Send support request'}</button></fieldset></form>
 {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}<h2>Your requests</h2><ResourceStatus {...resource}/>
 {resource.data?.items.length===0?<p>You have no support requests.</p>:null}<ul>{resource.data?.items.map(item=><li key={item.id}><h3>{item.subject}</h3><p>{item.status.replaceAll('_',' ')} · Updated {displayDate(item.updatedAt,presentation)}</p><p>Reference: {item.id}</p></li>)}</ul>
 {cursor?<button onClick={()=>setCursor('')}>First page</button>:null}{resource.data?.nextCursor?<button onClick={()=>setCursor(resource.data!.nextCursor!)}>Next page</button>:null}</main>;
}
