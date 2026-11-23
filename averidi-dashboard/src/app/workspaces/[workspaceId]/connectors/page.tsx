'use client';
import {useWorkspacePresentation} from '../../../../components/workspace/WorkspacePresentation';
import {useCustomPermission} from '../../../../components/workspace/WorkspacePermissions';
import {useState} from 'react';
import {useParams} from 'next/navigation';
import {connectorProviders,configurationSchemas,type ConnectorProvider} from '../../../../features/connectors/contracts';
import {dashboardRequest,displayDate,useDashboardResource,workspaceApi,workspacePageStyle} from '../../../../components/workspace/client';
import ResourceStatus from '../../../../components/workspace/ResourceStatus';
type Connection={id:string;provider:ConnectorProvider;enabled:boolean;source:{name:string;status:string;lastSyncedAt:string|null;lastErrorCode:string|null}};
const fields:Partial<Record<ConnectorProvider,{key:string;label:string;placeholder?:string}[]>>={
 GOOGLE_SHEETS:[{key:'spreadsheetId',label:'Spreadsheet URL or ID',placeholder:'https://docs.google.com/spreadsheets/d/...'},{key:'range',label:'Tab name or range (optional, defaults to the first tab)',placeholder:'Sheet1'}],
 SHOPIFY:[{key:'shop',label:'Store address (e.g. your-store or your-store.myshopify.com)',placeholder:'your-store.myshopify.com'}],
 QUICKBOOKS:[{key:'realmId',label:'QuickBooks company ID'}],
 XERO:[{key:'tenantId',label:'Xero organization ID'}],
 WOOCOMMERCE:[{key:'origin',label:'Store origin',placeholder:'https://your-store.com'}],
};
// Phase 1 offers Google Sheets; other adapters stay in code until their accounts are set up.
const offeredProviders:ConnectorProvider[]=['GOOGLE_SHEETS','SHOPIFY'];
const labels:Record<ConnectorProvider,string>={GOOGLE_SHEETS:'Google Sheets',SHOPIFY:'Shopify',WOOCOMMERCE:'WooCommerce',QUICKBOOKS:'QuickBooks',XERO:'Xero',HUBSPOT:'HubSpot',STRIPE:'Stripe',SQUARE:'Square'};
export default function ConnectionsPage(){
 const presentation=useWorkspacePresentation();
 const canManage=useCustomPermission('connectors.manage');
 const {workspaceId}=useParams<{workspaceId:string}>(),root=workspaceApi(workspaceId),resource=useDashboardResource<{connectors:Connection[]}>(root+'/connectors');
 const [provider,setProvider]=useState<ConnectorProvider>('GOOGLE_SHEETS'),[name,setName]=useState(''),[configuration,setConfiguration]=useState<Record<string,string>>({}),[mapping,setMapping]=useState<{from:string;to:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[credentialId,setCredentialId]=useState(''),[consumerKey,setConsumerKey]=useState(''),[consumerSecret,setConsumerSecret]=useState('');
 async function action(operation:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await operation();setNotice(message);resource.reload();}catch(error){setError(error instanceof Error?error.message:'Unable to update the connection.');}finally{setBusy(false);}}
 async function authorize(id:string){await action(async()=>{const result=await dashboardRequest<{authorizationUrl:string}>(root+'/connectors/'+encodeURIComponent(id)+'/authorize',{method:'POST'});const url=new URL(result.authorizationUrl);if(url.protocol!=='https:')throw Error('The provider returned an invalid sign-in address.');window.location.assign(url.href);},'Opening the provider sign-in page…');}
 async function create(){
  // Accept an official Sheets URL as well as a bare spreadsheet ID.
  let selectedConfiguration={...configuration};
  if(provider==='GOOGLE_SHEETS'){
    const entered=(configuration.spreadsheetId??'').trim();
    if(entered.startsWith('https://')){
      try{
        const url=new URL(entered);
        if(url.hostname!=='docs.google.com')throw Error('Invalid Google Sheets URL');
        const match=url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
        if(!match)throw Error('Invalid Google Sheets URL');
        selectedConfiguration={...selectedConfiguration,spreadsheetId:match[1]};
      }catch{setError('Paste a valid docs.google.com spreadsheet URL or spreadsheet ID.');return;}
    }else selectedConfiguration={...selectedConfiguration,spreadsheetId:entered};
    // Empty range: read the whole first tab. A bare tab name reads that whole tab.
    const range=(configuration.range??'').trim();
    selectedConfiguration={...selectedConfiguration,range:!range?'A:ZZ':/!|:/.test(range)?range:`'${range.replace(/'/g,"''")}'!A:ZZ`};
  }
  if(provider==='SHOPIFY'){
     // Accept "store", "store.myshopify.com" or an admin/store URL and normalise to store.myshopify.com.
     let shop=(configuration.shop??'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
     const admin=/admin\.shopify\.com\/store\/([a-z0-9-]+)/.exec((configuration.shop??'').toLowerCase());if(admin)shop=admin[1];
     if(shop&&!shop.endsWith('.myshopify.com'))shop=`${shop}.myshopify.com`;
     selectedConfiguration={...selectedConfiguration,shop};
    }
  const result=configurationSchemas[provider].safeParse({...selectedConfiguration,...(mapping.length?{fieldMapping:mapping}:{})});if(!result.success){setError('Check the connection details and field mappings. Destination field names must be unique.');return;}await action(async()=>{const created=await dashboardRequest<{connectorId:string}>(root+'/connectors',{method:'POST',body:JSON.stringify({name,provider,configuration:result.data})});setName('');setConfiguration({});setMapping([]);if(provider==='WOOCOMMERCE')setCredentialId(created.connectorId);},'Connection created. Select Connect to authorize access.');}
 async function saveCredentials(){await action(async()=>{try{await dashboardRequest(root+'/connectors/'+encodeURIComponent(credentialId)+'/credentials',{method:'POST',body:JSON.stringify({consumerKey,consumerSecret})});setCredentialId('');}finally{setConsumerKey('');setConsumerSecret('');}},'WooCommerce connection authorized.');}
 return <main style={workspacePageStyle}><h1>Data connections</h1><p>Connect a Google Sheet in three steps: paste the sheet link and create the connection, click Connect to sign in with Google (read-only access), then click Refresh to import the rows. The data then appears in Studio under “Use previously uploaded data”.</p><ResourceStatus {...resource}/>{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 <section><h2>Add a connection</h2><form onSubmit={event=>{event.preventDefault();void create();}}><fieldset disabled={!canManage||busy}><legend>Connection details</legend><p><label>Provider <select aria-label="Provider" value={provider} onChange={event=>{setProvider(event.target.value as ConnectorProvider);setConfiguration({});setMapping([]);}}>{connectorProviders.filter(value=>offeredProviders.includes(value)).map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label></p><p><label>Connection name <input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label></p>{fields[provider]?.map(field=><p key={field.key}><label>{field.label} <input required={!(provider==='GOOGLE_SHEETS'&&field.key==='range')} placeholder={field.placeholder} value={configuration[field.key]??''} onChange={event=>setConfiguration(current=>({...current,[field.key]:event.target.value}))}/></label></p>)}
 <details><summary>Advanced: rename columns while importing (optional)</summary><fieldset><legend>Field mapping (optional)</legend><p>Rename source fields as they are imported.</p>{mapping.map((field,index)=><p key={index}><label>Source field {index+1} <input required maxLength={120} value={field.from} onChange={event=>setMapping(current=>current.map((value,i)=>i===index?{...value,from:event.target.value}:value))}/></label>{' '}<label>Destination field {index+1} <input required maxLength={120} value={field.to} onChange={event=>setMapping(current=>current.map((value,i)=>i===index?{...value,to:event.target.value}:value))}/></label>{' '}<button type="button" onClick={()=>setMapping(current=>current.filter((_,i)=>i!==index))}>Remove mapping {index+1}</button></p>)}<button type="button" disabled={mapping.length>=100} onClick={()=>setMapping(current=>[...current,{from:'',to:''}])}>Add field mapping</button></fieldset></details><p><button type="submit">Create connection</button></p></fieldset></form></section>
 {credentialId?<section><h2>Authorize WooCommerce</h2><form onSubmit={event=>{event.preventDefault();void saveCredentials();}}><fieldset disabled={!canManage||busy}><legend>Read-only API credentials</legend><p><label>Consumer key <input required type="password" autoComplete="off" value={consumerKey} onChange={event=>setConsumerKey(event.target.value)}/></label></p><p><label>Consumer secret <input required type="password" autoComplete="off" value={consumerSecret} onChange={event=>setConsumerSecret(event.target.value)}/></label></p><button type="submit">Save credentials</button>{' '}<button type="button" onClick={()=>{setCredentialId('');setConsumerKey('');setConsumerSecret('');}}>Cancel</button></fieldset></form></section>:null}
 <section><h2>Your connections</h2><button onClick={resource.reload}>Refresh connection status</button>{resource.data?.connectors.length===0?<p>No connections yet.</p>:null}<ul>{resource.data?.connectors.map(connection=><li key={connection.id}><h3>{connection.source.name}</h3><p>{labels[connection.provider]} · {connection.source.status} · Last refreshed {displayDate(connection.source.lastSyncedAt,presentation)}</p>{connection.source.lastErrorCode?<p role="status">{connection.source.lastErrorCode}</p>:null}{connection.provider==='WOOCOMMERCE'?<button disabled={!canManage||busy} onClick={()=>{setCredentialId(connection.id);setConsumerKey('');setConsumerSecret('');}}>Set credentials</button>:<button disabled={!canManage||busy} onClick={()=>void authorize(connection.id)}>{connection.enabled?'Reconnect':'Connect'}</button>}{' '}<button disabled={!canManage||busy||!connection.enabled} onClick={()=>void action(()=>dashboardRequest(root+'/connectors/'+encodeURIComponent(connection.id)+'/refresh',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()}}),'Refresh queued. Follow progress in Jobs and schedules.')}>Refresh data</button>{' '}<button disabled={!canManage||busy} onClick={()=>{if(window.confirm('Disconnect this source? Existing datasets will remain.'))void action(()=>dashboardRequest(root+'/connectors/'+encodeURIComponent(connection.id),{method:'DELETE'}),'Connection disconnected.');}}>Disconnect</button></li>)}</ul></section></main>;
}
