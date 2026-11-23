import {z} from 'zod';
export const connectorProviders=['GOOGLE_SHEETS','SHOPIFY','STRIPE','QUICKBOOKS','WOOCOMMERCE','HUBSPOT','SQUARE','XERO'] as const;
export type ConnectorProvider=typeof connectorProviders[number];
const mapping=z.array(z.object({from:z.string().min(1).max(120),to:z.string().regex(/^[A-Za-z_][A-Za-z0-9_ ]{0,119}$/).refine(v=>!['__proto__','prototype','constructor'].includes(v))}).strict()).max(100).refine(m=>new Set(m.map(x=>x.to)).size===m.length);
const common={fieldMapping:mapping.optional()};
export const configurationSchemas={
 GOOGLE_SHEETS:z.object({...common,spreadsheetId:z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),range:z.string().min(1).max(200)}).strict(),
 SHOPIFY:z.object({...common,shop:z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/)}).strict(),
 STRIPE:z.object(common).strict(),
 QUICKBOOKS:z.object({...common,realmId:z.string().regex(/^\d{1,40}$/)}).strict(),
 WOOCOMMERCE:z.object({...common,origin:z.string().url().max(300)}).strict(),
 HUBSPOT:z.object(common).strict(),
 SQUARE:z.object(common).strict(),
 XERO:z.object({...common,tenantId:z.string().uuid()}).strict(),
};
export type ConnectorConfiguration={fieldMapping?:{from:string;to:string}[];spreadsheetId?:string;range?:string;shop?:string;realmId?:string;origin?:string;tenantId?:string};
export const connectorCreateSchema=z.object({provider:z.enum(connectorProviders),name:z.string().trim().min(1).max(120),configuration:z.unknown()}).strict();
export const apiCredentialSchema=z.object({consumerKey:z.string().regex(/^ck_[a-zA-Z0-9]{10,100}$/),consumerSecret:z.string().regex(/^cs_[a-zA-Z0-9]{10,100}$/)}).strict();
export function connectorConfiguration(provider:ConnectorProvider,value:unknown):ConnectorConfiguration {
 const result=configurationSchemas[provider].safeParse(value);if(!result.success)throw Error('INVALID_CONNECTOR_CONFIGURATION');
 const config=result.data as ConnectorConfiguration;
 if(provider==='WOOCOMMERCE'){
  const url=new URL(config.origin!);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port)throw Error('INVALID_CONNECTOR_CONFIGURATION');
  config.origin=url.origin;
 }
 return config;
}
export type ConnectorCredential={accessToken:string;refreshToken?:string;expiresAt?:number;accountId?:string;connectionId?:string};
export const credentialSchema=z.object({accessToken:z.string().min(1).max(16000),refreshToken:z.string().min(1).max(8000).optional(),expiresAt:z.number().finite().optional(),accountId:z.string().max(200).optional(),connectionId:z.string().max(200).optional()}).strict();
export class ConnectorError extends Error {
 constructor(code:string,readonly retryAfterSeconds=0){super(code);this.name='ConnectorError';}
}
export function assertConnectorsEnabled(){if(process.env.DASHBOARD_DATA_CONNECTORS_ENABLED!=='true')throw Error('CONNECTORS_DISABLED');}
export function providerApp(provider:ConnectorProvider){
 const clientId=process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_ID`],clientSecret=process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_SECRET`];
 if(!clientId||!clientSecret)throw Error('CONNECTOR_NOT_CONFIGURED');return {clientId,clientSecret};
}
export function assertProviderConfigured(provider:ConnectorProvider){
 assertConnectorsEnabled();
 if(!/^[a-fA-F0-9]{64}$/.test(process.env.DASHBOARD_CONNECTOR_ENCRYPTION_KEY??''))throw Error('CONNECTOR_NOT_CONFIGURED');
 if(provider==='WOOCOMMERCE'){if(!process.env.DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS)throw Error('CONNECTOR_NOT_CONFIGURED');}
 else providerApp(provider);
}
