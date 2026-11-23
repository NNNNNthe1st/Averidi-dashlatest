import assert from 'node:assert/strict';
import {type ConnectorProvider,type ConnectorConfiguration} from '../../src/features/connectors/contracts';
import {type ConnectorTransport,type ConnectorRequest} from '../../src/features/connectors/http';
import {connectorScopes,oauthEndpoints} from '../../src/features/connectors/oauth';
export const connectorConfigs:Record<ConnectorProvider,ConnectorConfiguration>={
 GOOGLE_SHEETS:{spreadsheetId:'sheet_test_123456',range:'Data!A1:C50002'},SHOPIFY:{shop:'dashboard-fixture.myshopify.com'},STRIPE:{},QUICKBOOKS:{realmId:'123456789'},WOOCOMMERCE:{origin:'https://dashboard-store.example.com'},HUBSPOT:{},SQUARE:{},XERO:{tenantId:'d15f1276-343d-4fa1-973d-aac322df52d7'},
};
export function providerSnapshot(provider:ConnectorProvider,input:ConnectorRequest){
 const url=new URL(input.url);let first=true;
 const headers:Record<string,string>={};let body:unknown;
 switch(provider){
  case 'GOOGLE_SHEETS':assert.equal(url.hostname,'sheets.googleapis.com');assert.match(url.pathname,/\/values\/Data/);assert.equal(url.searchParams.get('valueRenderOption'),'UNFORMATTED_VALUE');body={values:[['order_id','amount_major','currency'],['001',50,'USD'],['002',100,'USD']]};break;
  case 'SHOPIFY':{assert.equal(input.headers?.['X-Shopify-Access-Token']?.startsWith('access-'),true);const request=JSON.parse(input.body!);assert.match(request.query,/totalPriceSet/);first=!request.variables.after;body={data:{orders:{nodes:[{id:'gid://shopify/Order/'+(first?'001':'002'),name:first?'Order 1':'Order 2',createdAt:'2026-01-01T00:00:00Z',displayFinancialStatus:'PAID',totalPriceSet:{shopMoney:{amount:first?'50.00':'100.00',currencyCode:'USD'}}}],pageInfo:{hasNextPage:first,endCursor:first?'shop_cursor':''}}}};break;}
  case 'STRIPE':first=!url.searchParams.has('starting_after');body={data:[{id:first?'ch_001':'ch_002',amount:first?5000:10000,amount_refunded:0,currency:'usd',created:1767225600,status:'succeeded',paid:true,refunded:false}],has_more:first};break;
  case 'QUICKBOOKS':{const query=url.searchParams.get('query')!;assert.match(query,/SELECT \* FROM Invoice STARTPOSITION \d+ MAXRESULTS 100/);first=query.includes('STARTPOSITION 1 ');body={QueryResponse:{Invoice:Array.from({length:first?100:1},(_,i)=>({Id:String(first?i+1:101),DocNumber:'invoice',TxnDate:'2026-01-01',TotalAmt:50,Balance:0,CurrencyRef:{value:'USD'}}))}};break;}
  case 'WOOCOMMERCE':first=url.searchParams.get('page')==='1';assert.match(input.headers?.Authorization??'',/^Basic /);headers['x-wp-totalpages']='2';body=[{id:first?1:2,number:'Order',date_created_gmt:'2026-01-01T00:00:00',status:'completed',total:first?'50.00':'100.00',currency:'USD'}];break;
  case 'HUBSPOT':first=!url.searchParams.has('after');body={results:[{id:first?'001':'002',properties:{firstname:'Customer',lastname:'Fixture',createdate:'2026-01-01T00:00:00Z',lastmodifieddate:'2026-01-02T00:00:00Z'}}],...(first?{paging:{next:{after:'contact_after',link:'https://evil.example/ignored'}}}:{})};break;
  case 'SQUARE':assert.equal(input.headers?.['Square-Version'],'2026-09-16');first=!url.searchParams.has('cursor');body={payments:[{id:first?'payment_001':'payment_002',created_at:'2026-01-01T00:00:00Z',status:'COMPLETED',amount_money:{amount:first?5000:10000,currency:'USD'},order_id:'order'}],...(first?{cursor:'payment_cursor'}:{})};break;
  case 'XERO':assert.equal(input.headers?.['xero-tenant-id'],connectorConfigs.XERO.tenantId);first=url.searchParams.get('page')==='1';body={Invoices:Array.from({length:first?100:1},(_,i)=>({InvoiceID:'invoice_'+(first?i+1:101),InvoiceNumber:'invoice',Type:'ACCREC',Status:'AUTHORISED',DateString:'2026-01-01T00:00:00',Total:50,AmountDue:0,CurrencyCode:'USD'}))};break;
 }
 return {status:200,headers,body};
}
export function connectorFixture(provider:ConnectorProvider){
 const calls:ConnectorRequest[]=[];let refreshes=0;
 const transport:ConnectorTransport=async input=>{
  calls.push(input);
  if(input.url==='https://api.xero.com/connections')return {status:200,headers:{},body:[{id:'xero_connection',tenantId:connectorConfigs.XERO.tenantId}]};
  if(provider!=='WOOCOMMERCE'){
   const endpoints=oauthEndpoints(provider,connectorConfigs[provider]);
   if(input.url===endpoints.token){
    const form=input.headers?.['Content-Type']==='application/json'?JSON.parse(input.body!):Object.fromEntries(new URLSearchParams(input.body));
    assert.equal(input.method,'POST');assert.ok(form.grant_type==='authorization_code'||form.grant_type==='refresh_token');
    if(['QUICKBOOKS','XERO'].includes(provider))assert.match(input.headers?.Authorization??'',/^Basic /);else assert.equal(form.client_secret,'secret-'+provider);
    if(form.grant_type==='refresh_token'){refreshes++;assert.match(form.refresh_token,/^refresh-/);}
    else{assert.equal(form.code,'fixture-code');assert.match(form.redirect_uri,/^https:\/\/dashboard\.example\.test\/dashboard\/app\/api\/connectors\/callback$/);if(provider==='GOOGLE_SHEETS')assert.ok(form.code_verifier);if(provider==='SHOPIFY')assert.equal(form.expiring,'1');}
    return {status:200,headers:{},body:{access_token:'access-'+provider+'-'+refreshes,refresh_token:'refresh-'+provider+'-'+refreshes,expires_in:3600,scope:connectorScopes[provider].join(' '),...(provider==='STRIPE'?{stripe_user_id:'acct_fixture'}:{}),...(provider==='SQUARE'?{merchant_id:'merchant_fixture'}:{})}};
   }
   if(input.url===endpoints.revoke&&(provider!=='SHOPIFY'||input.body?.includes('appUninstall'))||input.url==='https://api.xero.com/connections/xero_connection')return {status:200,headers:{},body:provider==='SHOPIFY'?{data:{appUninstall:{userErrors:[]}}}:provider==='SQUARE'?{success:true}:{}};
  }
  return providerSnapshot(provider,input);
 };
 return {transport,calls,get refreshes(){return refreshes;}};
}
