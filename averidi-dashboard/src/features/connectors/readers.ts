import {type ConnectorProvider,type ConnectorConfiguration,type ConnectorCredential,ConnectorError} from './contracts';
import {connectorRequest,connectorTransport,type ConnectorTransport,object,records} from './http';
import {DASHBOARD_MAX_ROWS,type DashboardRow,type DashboardCell} from '../../engines/ingestion/ingest';
function cell(value:unknown):DashboardCell{if(value===undefined||value===null)return null;if(['string','boolean'].includes(typeof value))return value as string|boolean;if(typeof value==='number'&&Number.isFinite(value))return value;throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');}
function minor(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value))throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');return value;}
function row(value:Record<string,unknown>):DashboardRow{return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cell(v)]));}
function identity(value:unknown){if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);if(typeof value==='string'&&value.length>0&&value.length<=512)return value;throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');}
export async function readConnectorSnapshot(provider:ConnectorProvider,config:ConnectorConfiguration,credential:ConnectorCredential,transport:ConnectorTransport=connectorTransport,signal?:AbortSignal){
 const rows:DashboardRow[]=[],seen=new Set<string>(),cursors=new Set<string>();let cursor='',page=1,totalBytes=0;
 const headers:Record<string,string>={Authorization:'Bearer '+credential.accessToken};
 if(provider==='SHOPIFY'){delete headers.Authorization;headers['X-Shopify-Access-Token']=credential.accessToken;}
 if(provider==='SQUARE')headers['Square-Version']='2026-09-16';
 if(provider==='XERO')headers['xero-tenant-id']=config.tenantId!;
 if(provider==='WOOCOMMERCE'){const value=JSON.parse(credential.accessToken);headers.Authorization='Basic '+Buffer.from(value.consumerKey+':'+value.consumerSecret).toString('base64');}
 for(;;){
  signal?.throwIfAborted();if(page>501)throw new ConnectorError('CONNECTOR_LIMIT_EXCEEDED');
  let url='',body:string|undefined;
  switch(provider){
   case 'GOOGLE_SHEETS':url=`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(config.range!)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;break;
   case 'SHOPIFY':url=`https://${config.shop}/admin/api/2026-10/graphql.json`;body=JSON.stringify({query:'query Orders($after: String) { orders(first: 100, after: $after, sortKey: ID) { nodes { id name createdAt displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } } }',variables:{after:cursor||null}});break;
   case 'STRIPE':url='https://api.stripe.com/v1/charges?limit=100'+(cursor?'&starting_after='+encodeURIComponent(cursor):'');break;
   case 'QUICKBOOKS':url=`https://quickbooks.api.intuit.com/v3/company/${config.realmId}/query?query=`+encodeURIComponent(`SELECT * FROM Invoice STARTPOSITION ${(page-1)*100+1} MAXRESULTS 100`);break;
   case 'WOOCOMMERCE':url=config.origin+`/wp-json/wc/v3/orders?per_page=100&page=${page}&orderby=id&order=asc`;break;
   case 'HUBSPOT':url='https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,createdate,lastmodifieddate'+(cursor?'&after='+encodeURIComponent(cursor):'');break;
   case 'SQUARE':url='https://connect.squareup.com/v2/payments?limit=100&sort_order=ASC'+(cursor?'&cursor='+encodeURIComponent(cursor):'');break;
   case 'XERO':url=`https://api.xero.com/api.xro/2.0/Invoices?page=${page}&pageSize=100&order=InvoiceID`;break;
  }
  const response=await connectorRequest({url,method:body?'POST':'GET',headers:body?{...headers,'Content-Type':'application/json'}:headers,body,signal},transport);
  totalBytes+=Buffer.byteLength(JSON.stringify(response.body));if(totalBytes>50*1024*1024)throw new ConnectorError('CONNECTOR_LIMIT_EXCEEDED');
  let batch:DashboardRow[]=[],next='';let more=false;
  if(provider==='GOOGLE_SHEETS'){
   const values=object(response.body).values;if(!Array.isArray(values)||!values.length||!values.every(Array.isArray))throw new ConnectorError('CONNECTOR_EMPTY_SNAPSHOT');
   const names=values[0];if(!names.length||names.length>100||names.some((v:unknown)=>typeof v!=='string'||!v.trim()||v.length>120||['__proto__','prototype','constructor'].includes(v))||new Set(names).size!==names.length)throw new ConnectorError('CONNECTOR_INVALID_HEADERS');
   batch=values.slice(1).filter((v:unknown[])=>v.some(x=>x!==''&&x!==null)).map((values:unknown[])=>{if(values.length>names.length)throw Error('CONNECTOR_INVALID_RESPONSE');return row(Object.fromEntries(names.map((name:string,i:number)=>[name,values[i]??null])));});
  }else{
   const data=provider==='WOOCOMMERCE'?null:object(response.body);let values:Record<string,any>[];
   switch(provider){
    case 'SHOPIFY':{if(data!.errors?.length){if(data!.errors.some((e:any)=>e.extensions?.code==='THROTTLED'))throw new ConnectorError('CONNECTOR_RATE_LIMITED',60);throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');}const orders=object(data!.data?.orders);values=records(orders.nodes);more=orders.pageInfo?.hasNextPage===true;next=orders.pageInfo?.endCursor??'';batch=values.map(v=>row({id:identity(v.id),name:v.name,created_at:v.createdAt,financial_status:v.displayFinancialStatus,total_amount_major:v.totalPriceSet?.shopMoney?.amount,currency:v.totalPriceSet?.shopMoney?.currencyCode}));break;}
    case 'STRIPE':values=records(data!.data);if(typeof data!.has_more!=='boolean')throw Error('CONNECTOR_INVALID_RESPONSE');more=data!.has_more;next=values.length?identity(values.at(-1)!.id):'';batch=values.map(v=>row({id:identity(v.id),amount_minor:minor(v.amount),amount_refunded_minor:minor(v.amount_refunded),currency:v.currency,created_unix_seconds:v.created,status:v.status,paid:v.paid,refunded:v.refunded}));break;
    case 'QUICKBOOKS':{const result=object(data!.QueryResponse);values=records(result.Invoice??[]);more=values.length===100;batch=values.map(v=>row({id:identity(v.Id),document_number:v.DocNumber,transaction_date:v.TxnDate,total_amount_major:v.TotalAmt,balance_amount_major:v.Balance,currency:v.CurrencyRef?.value}));break;}
    case 'WOOCOMMERCE':values=records(response.body);{const total=Number(response.headers['x-wp-totalpages']);if(!Number.isInteger(total)||total<0)throw Error('CONNECTOR_INVALID_RESPONSE');more=page<total;}batch=values.map(v=>row({id:identity(v.id),number:v.number,created_at:v.date_created_gmt,status:v.status,total_amount_major:v.total,currency:v.currency}));break;
    case 'HUBSPOT':values=records(data!.results);next=data!.paging?.next?.after===undefined?'':String(data!.paging.next.after);more=!!next;batch=values.map(v=>row({id:identity(v.id),first_name:v.properties?.firstname,last_name:v.properties?.lastname,created_at:v.properties?.createdate,modified_at:v.properties?.lastmodifieddate}));break;
    case 'SQUARE':if(data!.errors?.length)throw Error('CONNECTOR_INVALID_RESPONSE');values=records(data!.payments??[]);next=data!.cursor??'';more=!!next;batch=values.map(v=>row({id:identity(v.id),created_at:v.created_at,status:v.status,amount_minor:minor(v.amount_money?.amount),currency:v.amount_money?.currency,order_id:v.order_id}));break;
    case 'XERO':values=records(data!.Invoices);more=values.length===100;batch=values.map(v=>row({id:identity(v.InvoiceID),invoice_number:v.InvoiceNumber,type:v.Type,status:v.Status,date:v.DateString??v.Date,total_amount_major:v.Total,amount_due_major:v.AmountDue,currency:v.CurrencyCode}));break;
    default:throw Error('CONNECTOR_INVALID_RESPONSE');
   }
  }
  for(const value of batch){if(provider!=='GOOGLE_SHEETS'){const id=identity(value.id);if(seen.has(id))throw new ConnectorError('CONNECTOR_UNSTABLE_SNAPSHOT');seen.add(id);}rows.push(value);if(rows.length>DASHBOARD_MAX_ROWS)throw new ConnectorError('CONNECTOR_LIMIT_EXCEEDED');}
  if(!more)break;if(!batch.length)throw new ConnectorError('CONNECTOR_UNSTABLE_SNAPSHOT');
  if(['SHOPIFY','STRIPE','HUBSPOT','SQUARE'].includes(provider)){if(typeof next!=='string'||!next||next.length>4096||cursors.has(next))throw new ConnectorError('CONNECTOR_UNSTABLE_SNAPSHOT');cursors.add(next);cursor=next;}
  page++;
 }
 if(!rows.length)throw new ConnectorError('CONNECTOR_EMPTY_SNAPSHOT');
 const mapping=config.fieldMapping;
 if(mapping?.length){const fields=new Set(Object.keys(rows[0]));if(mapping.some(m=>!fields.has(m.from)))throw Error('CONNECTOR_INVALID_MAPPING');return rows.map(r=>row(Object.fromEntries(mapping.map(m=>[m.to,r[m.from]]))));}
 return rows;
}
