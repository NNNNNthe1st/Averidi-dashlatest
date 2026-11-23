import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectorProviders,connectorConfiguration,ConnectorError} from '../src/features/connectors/contracts';
import {readConnectorSnapshot} from '../src/features/connectors/readers';
import {assertConnectorURL,publicAddress,connectorRequest} from '../src/features/connectors/http';
import {verifyConnectorCallback} from '../src/features/connectors/oauth';
import {connectorConfigs,providerSnapshot} from './fixtures/connectors';
for(const provider of connectorProviders)test(provider+' adapter reads the documented resource and completes pagination without guessing units',async()=>{
 const prior=process.env.DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS;process.env.DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS=connectorConfigs.WOOCOMMERCE.origin;
 let calls=0;
 try{
  const rows=await readConnectorSnapshot(provider,connectorConfigs[provider],{accessToken:provider==='WOOCOMMERCE'?JSON.stringify({consumerKey:'ck_fixture',consumerSecret:'cs_fixture'}):'access-'+provider},async input=>{calls++;return providerSnapshot(provider,input);});
  assert.equal(rows.length,['QUICKBOOKS','XERO'].includes(provider)?101:2);assert.equal(calls,provider==='GOOGLE_SHEETS'?1:2);
  if(provider==='GOOGLE_SHEETS')assert.equal(rows[0].order_id,'001');
  if(provider==='STRIPE'||provider==='SQUARE')assert.equal(rows[0].amount_minor,5000);
  if(provider==='SHOPIFY'||provider==='WOOCOMMERCE')assert.equal(rows[0].total_amount_major,'50.00');
 }finally{if(prior===undefined)delete process.env.DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS;else process.env.DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS=prior;}
});
test('connector egress is HTTPS-only, exact-host restricted and public-IP pinned',()=>{
 for(const url of ['http://api.stripe.com/v1/charges','https://api.stripe.com.evil.test','https://127.0.0.1/','https://169.254.169.254/','https://user:secret@api.stripe.com/','https://api.stripe.com:8443/','https://../bad'])assert.throws(()=>assertConnectorURL(url));
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.doesNotThrow(()=>assertConnectorURL('https://api.stripe.com/v1/charges'));
 assert.throws(()=>connectorConfiguration('STRIPE',{fieldMapping:[{from:'id',to:'__proto__'}]}));
 assert.throws(()=>connectorConfiguration('SHOPIFY',{shop:'evil.myshopify.com.evil.test'}));
 assert.throws(()=>connectorConfiguration('WOOCOMMERCE',{origin:'http://store.test'}));
});
test('rate limits, redirects, malformed pages, loops, invalid mappings and bad callbacks fail safely',async()=>{
 await assert.rejects(()=>connectorRequest({url:'https://api.stripe.com/v1/charges'},async()=>({status:429,headers:{'retry-after':'120'},body:{secret:'must never escape'}})),error=>error instanceof ConnectorError&&error.message==='CONNECTOR_RATE_LIMITED'&&error.retryAfterSeconds===120);
 await assert.rejects(()=>connectorRequest({url:'https://api.stripe.com/v1/charges'},async()=>({status:302,headers:{location:'https://untrusted.test'},body:null})),/CONNECTOR_REQUEST_REJECTED/);
 await assert.rejects(()=>readConnectorSnapshot('STRIPE',{}, {accessToken:'fixture'},async()=>({status:200,headers:{},body:{data:[{id:'same',amount:1,amount_refunded:0}],has_more:true}})),/CONNECTOR_UNSTABLE_SNAPSHOT/);
 await assert.rejects(()=>readConnectorSnapshot('GOOGLE_SHEETS',connectorConfigs.GOOGLE_SHEETS,{accessToken:'fixture'},async()=>({status:200,headers:{},body:{values:[['id','id'],['1','2']]}})),/CONNECTOR_INVALID_HEADERS/);
 await assert.rejects(()=>readConnectorSnapshot('STRIPE',{fieldMapping:[{from:'missing',to:'value'}]},{accessToken:'fixture'},async()=>({status:200,headers:{},body:{data:[{id:'a',amount:1,amount_refunded:0}],has_more:false}})),/CONNECTOR_INVALID_MAPPING/);
 assert.throws(()=>verifyConnectorCallback('QUICKBOOKS',connectorConfigs.QUICKBOOKS,new URLSearchParams({state:'state',code:'fixture',realmId:'wrong'})),/CONNECTOR_ACCOUNT_MISMATCH/);
 assert.throws(()=>verifyConnectorCallback('STRIPE',{},new URLSearchParams('code=a&code=b')),/CONNECTOR_OAUTH_REJECTED/);
 assert.throws(()=>verifyConnectorCallback('STRIPE',{},new URLSearchParams('error=access_denied')),/CONNECTOR_OAUTH_REJECTED/);
});
