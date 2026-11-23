import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {type ConnectorProvider,type ConnectorConfiguration,type ConnectorCredential,providerApp,ConnectorError,credentialSchema} from './contracts';
import {connectorRequest,connectorTransport,type ConnectorTransport,object,records} from './http';
export const connectorScopes:Record<ConnectorProvider,string[]>={
 GOOGLE_SHEETS:['https://www.googleapis.com/auth/spreadsheets.readonly'],SHOPIFY:['read_orders'],STRIPE:['read_only'],QUICKBOOKS:['com.intuit.quickbooks.accounting'],WOOCOMMERCE:[],HUBSPOT:['crm.objects.contacts.read'],SQUARE:['PAYMENTS_READ'],XERO:['offline_access','accounting.invoices.read'],
};
export function oauthEndpoints(provider:ConnectorProvider,config:ConnectorConfiguration){
 switch(provider){
  case 'GOOGLE_SHEETS':return {authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',revoke:'https://oauth2.googleapis.com/revoke'};
  case 'SHOPIFY':return {authorize:`https://${config.shop}/admin/oauth/authorize`,token:`https://${config.shop}/admin/oauth/access_token`,revoke:`https://${config.shop}/admin/api/2026-10/graphql.json`};
  case 'STRIPE':return {authorize:'https://connect.stripe.com/oauth/authorize',token:'https://connect.stripe.com/oauth/token',revoke:'https://connect.stripe.com/oauth/deauthorize'};
  case 'QUICKBOOKS':return {authorize:'https://appcenter.intuit.com/connect/oauth2',token:'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',revoke:'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'};
  case 'HUBSPOT':return {authorize:'https://app.hubspot.com/oauth/authorize',token:'https://api.hubapi.com/oauth/2026-03/token',revoke:'https://api.hubapi.com/oauth/2026-03/token/revoke'};
  case 'SQUARE':return {authorize:'https://connect.squareup.com/oauth2/authorize',token:'https://connect.squareup.com/oauth2/token',revoke:'https://connect.squareup.com/oauth2/revoke'};
  case 'XERO':return {authorize:'https://login.xero.com/identity/connect/authorize',token:'https://identity.xero.com/connect/token',revoke:'https://identity.xero.com/connect/revocation'};
  default:throw Error('CONNECTOR_OAUTH_UNSUPPORTED');
 }
}
export function connectorAuthorizationURL(provider:ConnectorProvider,config:ConnectorConfiguration,state:string,redirect:string,verifier:string){
 const {clientId}=providerApp(provider),url=new URL(oauthEndpoints(provider,config).authorize);
 for(const [key,value] of Object.entries({client_id:clientId,response_type:'code',redirect_uri:redirect,state,scope:connectorScopes[provider].join(provider==='SHOPIFY'?',':' ')}))url.searchParams.set(key,value);
 if(provider==='GOOGLE_SHEETS'){url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent');url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');}
 if(provider==='SQUARE')url.searchParams.set('session','false');
 return url.toString();
}
export function verifyConnectorCallback(provider:ConnectorProvider,config:ConnectorConfiguration,params:URLSearchParams){
 for(const key of new Set(params.keys()))if(params.getAll(key).length!==1)throw Error('CONNECTOR_OAUTH_REJECTED');
 if(params.has('error')||!params.get('code')||params.get('code')!.length>4096)throw Error('CONNECTOR_OAUTH_REJECTED');
 if(provider==='QUICKBOOKS'&&params.get('realmId')!==config.realmId)throw Error('CONNECTOR_ACCOUNT_MISMATCH');
 if(provider==='SHOPIFY'){
  if(params.get('shop')!==config.shop)throw Error('CONNECTOR_ACCOUNT_MISMATCH');
  const received=params.get('hmac')??'',timestamp=Number(params.get('timestamp'));
  const message=[...params].filter(([key])=>key!=='hmac').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');
  const expected=createHmac('sha256',providerApp(provider).clientSecret).update(message).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(received)||!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>300||!timingSafeEqual(Buffer.from(expected),Buffer.from(received)))throw Error('CONNECTOR_OAUTH_REJECTED');
 }
}
export async function exchangeConnectorToken(provider:ConnectorProvider,config:ConnectorConfiguration,input:{code:string;redirect:string;verifier:string}|{credential:ConnectorCredential},transport:ConnectorTransport=connectorTransport,signal?:AbortSignal){
 const app=providerApp(provider),refresh='credential' in input;
 const values:Record<string,string>={grant_type:refresh?'refresh_token':'authorization_code',client_id:app.clientId,client_secret:app.clientSecret};
 if(refresh){if(!input.credential.refreshToken)throw new ConnectorError('CONNECTOR_AUTH_REQUIRED');values.refresh_token=input.credential.refreshToken;}
 else{values.code=input.code;values.redirect_uri=input.redirect;if(provider==='GOOGLE_SHEETS')values.code_verifier=input.verifier;if(provider==='SHOPIFY')values.expiring='1';}
 const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
 if(provider==='QUICKBOOKS'||provider==='XERO'){headers.Authorization='Basic '+Buffer.from(app.clientId+':'+app.clientSecret).toString('base64');delete values.client_id;delete values.client_secret;}
 let body=new URLSearchParams(values).toString();
 if(provider==='SQUARE'){headers['Content-Type']='application/json';headers['Square-Version']='2026-09-16';body=JSON.stringify(values);}
 const response=object((await connectorRequest({url:oauthEndpoints(provider,config).token,method:'POST',headers,body,signal},transport)).body);
 if(response.error||response.errors)throw new ConnectorError('CONNECTOR_AUTH_REQUIRED');
 if(response.scope!==undefined){if(typeof response.scope!=='string')throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');const scopes=response.scope.split(/[ ,]+/);if(connectorScopes[provider].some(s=>!scopes.includes(s)))throw new ConnectorError('CONNECTOR_PERMISSION_REQUIRED');}
 const expiresAt=response.expires_at?Date.parse(response.expires_at):response.expires_in!==undefined?Date.now()+Number(response.expires_in)*1000:undefined;
 if(expiresAt!==undefined&&(!Number.isFinite(expiresAt)||expiresAt<=Date.now()))throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');
 const parsed=credentialSchema.safeParse({accessToken:response.access_token,refreshToken:response.refresh_token??(refresh?input.credential.refreshToken:undefined),expiresAt,accountId:response.stripe_user_id??response.merchant_id??(refresh?input.credential.accountId:undefined),connectionId:refresh?input.credential.connectionId:undefined});
 if(!parsed.success||response.token_type!==undefined&&String(response.token_type).toLowerCase()!=='bearer')throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');
 if(provider!=='STRIPE'&&(!parsed.data.refreshToken||!parsed.data.expiresAt))throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');
 if(provider==='XERO'&&!refresh){
  const tenants=records((await connectorRequest({url:'https://api.xero.com/connections',headers:{Authorization:'Bearer '+parsed.data.accessToken},signal},transport)).body);
  const tenant=tenants.find(t=>t.tenantId===config.tenantId);if(!tenant||typeof tenant.id!=='string')throw Error('CONNECTOR_ACCOUNT_MISMATCH');parsed.data.connectionId=tenant.id;
 }
 if(provider==='STRIPE'&&!parsed.data.accountId)throw Error('CONNECTOR_ACCOUNT_MISMATCH');
 return parsed.data;
}
export async function revokeConnectorToken(provider:ConnectorProvider,config:ConnectorConfiguration,credential:ConnectorCredential,transport:ConnectorTransport=connectorTransport){
 if(provider==='WOOCOMMERCE')return {remoteRevoked:false,keyRemovalRequired:true};
 const app=providerApp(provider),url=oauthEndpoints(provider,config).revoke;
 let headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'},body=new URLSearchParams({token:credential.refreshToken??credential.accessToken}).toString(),method:'POST'|'DELETE'='POST',endpoint=url;
 if(provider==='QUICKBOOKS'||provider==='XERO')headers.Authorization='Basic '+Buffer.from(app.clientId+':'+app.clientSecret).toString('base64');
 if(provider==='QUICKBOOKS'){headers['Content-Type']='application/json';body=JSON.stringify({token:credential.refreshToken??credential.accessToken});}
 if(provider==='HUBSPOT')body=new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,token:credential.refreshToken??credential.accessToken,token_type_hint:'refresh_token'}).toString();
 if(provider==='STRIPE'){headers.Authorization='Bearer '+app.clientSecret;body=new URLSearchParams({client_id:app.clientId,stripe_user_id:credential.accountId!}).toString();}
 if(provider==='SQUARE'){headers={'Content-Type':'application/json',Authorization:'Client '+app.clientSecret,'Square-Version':'2026-09-16'};body=JSON.stringify({client_id:app.clientId,access_token:credential.accessToken});}
 if(provider==='SHOPIFY'){headers={'Content-Type':'application/json','X-Shopify-Access-Token':credential.accessToken};body=JSON.stringify({query:'mutation { appUninstall { userErrors { field message } } }'});}
 // Revoke only this Xero organisation connection, leaving other authorised organisations intact.
 if(provider==='XERO'&&credential.connectionId){endpoint='https://api.xero.com/connections/'+encodeURIComponent(credential.connectionId);method='DELETE';headers={Authorization:'Bearer '+credential.accessToken};body='';}
 try{
  const result=await connectorRequest({url:endpoint,method,headers,body},transport);
  if(provider==='SHOPIFY'){const data=object(result.body);if(data.errors||!data.data?.appUninstall||data.data.appUninstall.userErrors?.length)throw Error('CONNECTOR_REVOCATION_FAILED');}
  if(provider==='SQUARE'&&object(result.body).success!==true)throw Error('CONNECTOR_REVOCATION_FAILED');
 }catch(error){if(error instanceof ConnectorError&&error.message==='CONNECTOR_AUTH_REQUIRED')return {remoteRevoked:false,alreadyUnauthorized:true};throw error;}
 return {remoteRevoked:true};
}
