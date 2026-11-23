'use client';
import {useWorkspacePresentation} from './WorkspacePresentation';
import {useState} from 'react';
import {useDashboardResource,displayDate} from './client';
import ResourceStatus from './ResourceStatus';
type Entry={id:string;createdAt:string;resourceType:string;operation:string;actorSubject:string;actorSource:string;action:string|null;changedFields:string[]};
type Page={items:Entry[];nextCursor:string|null};
const human=(value:string)=>value.replace(/^Dashboard/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
export default function AuditHistory({url}:{url:string}){
 const presentation=useWorkspacePresentation();
 const [history,setHistory]=useState<{url:string;cursors:(string|null)[]}>({url,cursors:[null]}),cursors=history.url===url?history.cursors:[null],cursor=cursors.at(-1);
 const resource=useDashboardResource<Page>(url+'?limit=25'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
 return <><p>Changes are recorded without source rows, messages or credential values. “Database service” identifies a write without an attributed customer action; it does not identify a customer.</p><ResourceStatus {...resource}/>{resource.data?<><p>Page {cursors.length}. Up to 25 events per page.</p><div role="region" aria-label="Activity history table" tabIndex={0} style={{overflowX:'auto',maxWidth:'100%'}}><table><caption>Recorded resource changes</caption><thead><tr><th scope="col">When</th><th scope="col">Resource</th><th scope="col">Change</th><th scope="col">Actor</th><th scope="col">Fields changed</th></tr></thead><tbody>{resource.data.items.map(event=><tr key={event.id}><td>{displayDate(event.createdAt,presentation)}</td><td>{human(event.resourceType)}</td><td>{event.action?human(event.action):event.operation==='INSERT'?'Created':event.operation==='DELETE'?'Removed':'Updated'}</td><td>{event.actorSource==='DATABASE_ROLE'?'Database service':event.actorSource==='WORKER'?'Background job':event.actorSubject}</td><td>{event.changedFields.map(human).join(', ')}</td></tr>)}</tbody></table></div>{cursors.length>1?<button type="button" onClick={()=>setHistory({url,cursors:cursors.slice(0,-1)})}>Newer events</button>:null}{' '}{resource.data.nextCursor?<button type="button" onClick={()=>setHistory({url,cursors:[...cursors,resource.data!.nextCursor]})}>Older events</button>:null}</>:null}</>;
}
