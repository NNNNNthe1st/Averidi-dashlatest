import {z} from 'zod';
export const customProviders=['CUSTOM_API','DATA_WEBHOOK','GOOGLE_ANALYTICS','GOOGLE_ADS'] as const;
export type CustomProvider=typeof customProviders[number];
const field=z.string().min(1).max(120).refine(s=>!['__proto__','constructor','prototype'].includes(s));
const path=z.string().max(200).refine(s=>s===''||s.split('.').every(p=>/^[A-Za-z0-9_-]{1,64}$/.test(p)&&!['__proto__','constructor','prototype'].includes(p)));
export const mapping=z.array(z.object({from:field,to:field.refine(s=>s.trim()===s)}).strict()).max(100).refine(m=>new Set(m.map(x=>x.to)).size===m.length);
const common={identityField:field,fieldMapping:mapping.optional()};
export const apiConfigSchema=z.object({...common,endpoint:z.url().max(2000).refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!u.port;}),auth:z.enum(['NONE','BEARER','API_KEY']),apiKeyHeader:z.enum(['X-API-Key','api-key','X-Auth-Token','X-Token']).default('X-API-Key'),itemsPath:path.default('records'),pagination:z.enum(['SINGLE','CURSOR']).default('SINGLE'),cursorParameter:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).default('cursor'),nextCursorPath:path.default('nextCursor'),snapshotPath:path.default('snapshotId'),totalPath:path.default('total'),parameters:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),z.string().max(512)).default({})}).strict().refine(c=>Object.keys(c.parameters).length<=20&&!Object.keys(c.parameters).some(k=>/token|secret|password|authorization|api.?key/i.test(k))&&!(c.cursorParameter in c.parameters)&&(c.pagination!=='CURSOR'||!!c.nextCursorPath&&!!c.snapshotPath&&!!c.totalPath));
export const webhookConfigSchema=z.object(common).strict();
export type ApiConfig=z.infer<typeof apiConfigSchema>;
export type WebhookConfig=z.infer<typeof webhookConfigSchema>;
export const tokenSchema=z.object({token:z.string().min(1).max(16000).regex(/^[\x21-\x7e]+$/),expiresAt:z.iso.datetime().optional()}).strict();
export function assertCustomSourcesEnabled(){if(process.env.DASHBOARD_DATA_CONNECTORS_ENABLED!=='true'||process.env.DASHBOARD_CUSTOM_SOURCES_ENABLED!=='true')throw Error('CONNECTORS_DISABLED');if(!/^[a-fA-F0-9]{64}$/.test(process.env.DASHBOARD_CONNECTOR_ENCRYPTION_KEY??''))throw Error('CONNECTOR_NOT_CONFIGURED');}
export function customApiUrl(value:string){
 let url:URL;try{url=new URL(value);}catch{throw Error('INVALID_CUSTOM_SOURCE');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||url.search)throw Error('CONNECTOR_ENDPOINT_FORBIDDEN');
 const allowed=(process.env.DASHBOARD_CUSTOM_API_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!allowed.some(s=>{try{const candidate=new URL(s);return candidate.protocol==='https:'&&candidate.origin===s&&candidate.origin===url.origin;}catch{return false;}}))throw Error('CONNECTOR_ENDPOINT_FORBIDDEN');return url;
}
export const marketingWindow=z.enum(['LAST_7_DAYS','LAST_30_DAYS','THIS_MONTH','LAST_MONTH']);
export const analyticsConfigSchema=z.object({propertyId:z.string().regex(/^[1-9]\d{0,19}$/),window:marketingWindow,fieldMapping:mapping.optional()}).strict();
export const adsConfigSchema=z.object({customerId:z.string().regex(/^\d{10}$/),loginCustomerId:z.string().regex(/^\d{10}$/).optional(),window:marketingWindow,fieldMapping:mapping.optional()}).strict();
export type AnalyticsConfig=z.infer<typeof analyticsConfigSchema>;
export type AdsConfig=z.infer<typeof adsConfigSchema>;
export type MarketingProvider='GOOGLE_ANALYTICS'|'GOOGLE_ADS';
export function marketingProvider(value:string):value is MarketingProvider{return value==='GOOGLE_ANALYTICS'||value==='GOOGLE_ADS';}
export function customConfiguration(provider:CustomProvider,input:unknown):ApiConfig|WebhookConfig|AnalyticsConfig|AdsConfig{const schema=provider==='CUSTOM_API'?apiConfigSchema:provider==='DATA_WEBHOOK'?webhookConfigSchema:provider==='GOOGLE_ANALYTICS'?analyticsConfigSchema:adsConfigSchema;const p=schema.safeParse(input);if(!p.success)throw Error('INVALID_CUSTOM_SOURCE');if(provider==='CUSTOM_API')customApiUrl((p.data as ApiConfig).endpoint);return p.data;}
