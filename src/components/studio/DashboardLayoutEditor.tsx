'use client';
import {useEffect,useState,useRef} from 'react';
import type {DashboardConfig} from '../../engines/generation/dashboard-templates';
import {type DashboardLayoutPage,type WidgetPlacement,positionWidget,transferWidget} from '../../features/views/layout';
import {dashboardRequest} from '../workspace/client';
import {useWorkspaceRole,useWorkspacePermission} from '../workspace/WorkspacePermissions';
type Document={pages:DashboardLayoutPage[];customized:boolean;updatedAt:string};
export function useDashboardLayout(api:string,revision:string,onSaved:()=>void,onDirty:(dirty:boolean)=>void,enabled=true){
 const saveInFlight=useRef(false);
 const [paused,setPaused]=useState(false);
 const [reload,setReload]=useState(0);
 const [document,setDocument]=useState<Document|null>(null),[selected,setSelected]=useState(''),[dirty,setDirty]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState(false);
 useEffect(()=>{if(!enabled){setLoading(false);setDocument(null);setDirty(false);return;}const controller=new AbortController();setLoading(true);setError('');setDocument(null);setDirty(false);setPaused(false);dashboardRequest<Document>(api+'/layout',{signal:controller.signal}).then(data=>{if(controller.signal.aborted)return;setDocument(data);setSelected(id=>data.pages.some(p=>p.id===id)?id:data.pages[0].id);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unable to load dashboard pages.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[api,revision,reload,enabled]);
 useEffect(()=>onDirty(dirty),[dirty,onDirty]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 function change(action:(pages:DashboardLayoutPage[])=>DashboardLayoutPage[]){if(!document)return;try{const pages=action(document.pages);setDocument({...document,pages,customized:true});setDirty(true);setError('');setNotice('Unsaved page and layout changes.');}catch(e){setError(e instanceof Error&&e.message==='LAYOUT_OVERLAP'?'That space is occupied. Choose another row or column.':'Choose a valid position and size within the 12-column grid.');}}
 async function save(){if(!document||saving||saveInFlight.current)return;saveInFlight.current=true;setPaused(false);setSaving(true);setError('');try{const saved=await dashboardRequest<{updatedAt:string}>(api+'/layout',{method:'POST',body:JSON.stringify({pages:document.pages,expectedUpdatedAt:document.updatedAt})});setDocument({...document,updatedAt:saved.updatedAt});setDirty(false);setNotice('Dashboard pages and layout saved.');onSaved();}catch(e){setPaused(true);setError(e instanceof Error?e.message:'Unable to save layout.');}finally{saveInFlight.current=false;setSaving(false);}}
 const autoSave=useRef(save);autoSave.current=save;
 useEffect(()=>{if(!dirty||saving||loading||paused)return;const timer=setTimeout(()=>void autoSave.current(),900);return()=>clearTimeout(timer);},[document,dirty,saving,loading,paused]);
 function discard(){if(window.confirm('Discard unsaved page and layout changes?'))setReload(n=>n+1);}
 return {discard,document,selected,setSelected,dirty,loading,saving,error,setError,notice,editing,setEditing,change,save};
}
export type LayoutState=ReturnType<typeof useDashboardLayout>;
function PlacementEditor({placement,widget,pages,pageId,layout,disabled}:{placement:WidgetPlacement;widget:DashboardConfig['widgets'][number];pages:DashboardLayoutPage[];pageId:string;layout:LayoutState;disabled:boolean}){
 const [position,setPosition]=useState(placement);
 return <fieldset disabled={disabled} style={{minWidth:0,margin:'12px 0'}}><legend>{widget.title}</legend>
  <label>Page for {widget.title} <select aria-label={'Page for '+widget.title} value={pageId} onChange={e=>layout.change(pages=>transferWidget(pages,widget.id,e.target.value,widget.kind))}>{pages.map(page=><option key={page.id} value={page.id}>{page.name}</option>)}</select></label>
  {(['x','y','width','height'] as const).map(key=><label key={key} style={{display:'inline-block',margin:6}}>{({x:'Column',y:'Row',width:'Width',height:'Height'})[key]} for {widget.title} <input id={'layout-'+widget.id+'-'+key} style={{width:64}} type="number" required min={key==='width'||key==='height'?2:1} max={key==='y'?1000:12} value={position[key]+(key==='x'||key==='y'?1:0)} onChange={e=>setPosition({...position,[key]:e.target.valueAsNumber-(key==='x'||key==='y'?1:0)})}/></label>)}
  <button type="button" onClick={()=>layout.change(pages=>positionWidget(pages,pageId,position))}>Apply layout for {widget.title}</button>
 </fieldset>;
}
export default function DashboardLayoutEditor({layout,definition,locked,readOnly=false}:{layout:LayoutState;definition:DashboardConfig;locked:boolean;readOnly?:boolean}){
 const canEdit=useWorkspacePermission('views.manage')&&!readOnly,doc=layout.document,page=doc?.pages.find(p=>p.id===layout.selected);
 const [name,setName]=useState('');
 const disabled=locked||layout.loading||layout.saving;
 return <section aria-label="Dashboard pages and layout" style={{margin:'16px 0'}}>
  {layout.loading?<p role="status">Loading dashboard pages…</p>:null}{layout.error?<p role="alert">{layout.error}</p>:null}{layout.notice?<p role="status">{layout.notice}</p>:null}
  {doc&&doc.pages.length>1?<label>Dashboard page <select aria-label="Dashboard page" value={layout.selected} onChange={e=>layout.setSelected(e.target.value)}>{doc.pages.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:null}
  {canEdit&&doc&&page?<details open={layout.editing} onToggle={e=>layout.setEditing(e.currentTarget.open)}><summary>Edit pages and widget layout</summary>
   {locked?<p>Save or reload your dashboard content changes before editing its pages and layout.</p>:null}
   <p>Use a 12-column grid. Drag a card to move it, or drag its resize handle. The controls below provide keyboard and touch alternatives. Occupied spaces are refused; hidden widgets also reserve their saved positions. Filters apply across pages; metric reports include the dashboard’s metrics.</p>
   <label>Page name <input aria-label="Page name" maxLength={80} value={name} onChange={e=>setName(e.target.value)} disabled={disabled}/></label>{' '}
   <button type="button" disabled={disabled||!name.trim()} onClick={()=>{layout.change(pages=>pages.map(p=>p.id===page.id?{...p,name:name.trim()}:p));setName('');}}>Rename page</button>{' '}
   <button type="button" disabled={disabled||!name.trim()||doc.pages.length>=12} onClick={()=>{const id=crypto.randomUUID();layout.change(pages=>[...pages,{id,name:name.trim(),widgets:[]}]);layout.setSelected(id);setName('');}}>Add page</button>{' '}
   {([-1,1] as const).map(direction=><button key={direction} type="button" disabled={disabled||doc.pages.findIndex(p=>p.id===page.id)+(direction)<0||doc.pages.findIndex(p=>p.id===page.id)+direction>=doc.pages.length} onClick={()=>layout.change(pages=>{const list=[...pages],i=list.findIndex(p=>p.id===page.id);[list[i],list[i+direction]]=[list[i+direction],list[i]];return list;})}>{direction===-1?'Move page earlier':'Move page later'}</button>)}{' '}
   <button type="button" disabled={disabled||doc.pages.length===1} onClick={()=>{if(!window.confirm('Delete this page? Its widgets will move to the first remaining page.'))return;const target=doc.pages.find(p=>p.id!==page.id)!;layout.change(pages=>{let next=pages;for(const p of page.widgets)next=transferWidget(next,p.widgetId,target.id,definition.widgets.find(w=>w.id===p.widgetId)!.kind);return next.filter(p=>p.id!==page.id);});layout.setSelected(target.id);}}>Delete page</button>
   <p>Selected page: {page.name}. Up to 12 pages can be saved. Valid layout changes save automatically after you pause editing.</p>
   {definition.widgets.map(widget=>{const owner=doc.pages.find(p=>p.widgets.some(w=>w.widgetId===widget.id)),placement=owner?.widgets.find(w=>w.widgetId===widget.id);return owner&&placement?<PlacementEditor key={widget.id+owner.id+JSON.stringify(placement)} placement={placement} widget={widget} pages={doc.pages} pageId={owner.id} layout={layout} disabled={disabled}/>:null;})}
   <button type="button" disabled={disabled||!layout.dirty} onClick={()=>void layout.save()}>{layout.saving?'Saving layout…':'Save pages and layout'}</button>{' '}<button type="button" disabled={disabled||!layout.dirty} onClick={layout.discard}>Discard page and layout changes</button>
  </details>:null}
 </section>;
}
