import {z} from 'zod';
// Dashboard-owned wire contracts. Never import another Averidi application's implementation.
export const DASHBOARD_CONTRACT_VERSION='1.0' as const;
export const EXTERNAL_AVERIDI_INTEGRATION_ENABLED=false as const;
export const DASHBOARD_INTEGRATION_BASE_PATH='/dashboard/app/api/integrations/v1' as const;
export const dashboardResourceId=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const httpsIssuer=z.string().max(2048).url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;},'Expected an HTTPS issuer without credentials/query/fragment');
export const externalIdentitySchema=z.object({issuer:httpsIssuer,subject:z.string().min(1).max(255).refine(v=>v.trim().length>0)}).strict();
export const adminPermissionSchema=z.enum(['dashboard:read','dashboard:manage']);
export const dashboardAdminAccessSchema=z.object({actor:externalIdentitySchema,permissions:z.array(adminPermissionSchema).min(1).max(2).refine(v=>new Set(v).size===v.length)}).strict();
const unix=z.number().int().nonnegative();
const baseClaims={iss:httpsIssuer,sub:z.string().min(1).max(255).refine(v=>!!v.trim()),aud:z.string().min(1).max(256),iat:unix,exp:unix,jti:z.string().min(16).max(128)};
export const adminBridgeClaimsSchema=z.object({...baseClaims,token_use:z.literal('access'),integration:z.literal('averidi-dashboard-admin-v1'),dashboard_permissions:z.array(adminPermissionSchema).min(1).max(2).refine(v=>new Set(v).size===v.length),nbf:unix.optional()}).strict().refine(v=>v.exp>v.iat&&v.exp-v.iat<=300,'Administrative bridge tokens must expire within five minutes');
export const integrationPermissionSchema=z.enum(['dashboard:subscription:read','dashboard:navigation:read']);
export const ecosystemClaimsSchema=z.object({...baseClaims,token_use:z.literal('access'),integration:z.literal('averidi-dashboard-ecosystem-v1'),dashboard_permissions:z.array(integrationPermissionSchema).min(1).max(2).refine(v=>new Set(v).size===v.length),workspace_ids:z.array(dashboardResourceId).min(1).max(100).refine(v=>new Set(v).size===v.length),nbf:unix.optional()}).strict().refine(v=>v.exp>v.iat&&v.exp-v.iat<=300,'Integration tokens must expire within five minutes');
export const subscriptionDecisionSchema=z.object({active:z.boolean(),planCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).nullable(),checkedAt:z.string().datetime({offset:true})}).strict().refine(v=>v.active?v.planCode!==null:v.planCode===null,'Only active decisions expose an entitled plan');
export const subscriptionSummarySchema=z.object({contractVersion:z.literal(DASHBOARD_CONTRACT_VERSION),product:z.literal('averidi-dashboard'),workspaceId:dashboardResourceId,subscription:subscriptionDecisionSchema,status:z.enum(['ACTIVE','PAST_DUE','CANCELED','INACTIVE']),currentPeriodEnd:z.string().datetime({offset:true}).nullable()}).strict().superRefine((v,c)=>{
 if(v.subscription.active&&(v.status!=='ACTIVE'||!v.currentPeriodEnd||Date.parse(v.currentPeriodEnd)<=Date.parse(v.subscription.checkedAt)))c.addIssue({code:'custom',message:'Active summaries require a valid Dashboard-owned period'});
});
const localPath=z.string().max(512).regex(/^\/dashboard\/app\/(?:workspaces(?:\/[A-Za-z0-9_-]{1,128}\/(?:studio|members))?|api\/auth\/login)$/);
export const navigationSchema=z.object({contractVersion:z.literal(DASHBOARD_CONTRACT_VERSION),product:z.literal('averidi-dashboard'),workspaceId:dashboardResourceId,links:z.object({workspaces:localPath,studio:localPath,members:localPath.optional(),login:localPath}).strict()}).strict().superRefine((v,c)=>{
 if(v.links.workspaces!=="/dashboard/app/workspaces"||v.links.login!=="/dashboard/app/api/auth/login"||v.links.studio!==`/dashboard/app/workspaces/${v.workspaceId}/studio`||(v.links.members&&v.links.members!==`/dashboard/app/workspaces/${v.workspaceId}/members`))c.addIssue({code:"custom",message:"Navigation must remain within its Dashboard workspace"});
});
export const contractErrorSchema=z.object({contractVersion:z.literal(DASHBOARD_CONTRACT_VERSION),error:z.enum(['INTEGRATIONS_INACTIVE','UNAUTHORIZED','FORBIDDEN','INVALID_CONTRACT_REQUEST','INVALID_CONTRACT_RESPONSE','DASHBOARD_NOT_RELEASED','INTEGRATION_UNAVAILABLE']),requestId:z.string().uuid()}).strict();
const eventBase={contractVersion:z.literal(DASHBOARD_CONTRACT_VERSION),product:z.literal('averidi-dashboard'),eventId:z.string().uuid(),workspaceId:dashboardResourceId,occurredAt:z.string().datetime({offset:true})};
export const dashboardEventSchema=z.discriminatedUnion('type',[
 z.object({...eventBase,type:z.literal('dashboard.subscription.changed.v1'),data:z.object({summary:subscriptionSummarySchema}).strict()}).strict(),
 z.object({...eventBase,type:z.literal('dashboard.workspace.changed.v1'),data:z.object({name:z.string().trim().min(2).max(120)}).strict()}).strict(),
]).superRefine((v,c)=>{if(v.type==='dashboard.subscription.changed.v1'&&v.workspaceId!==v.data.summary.workspaceId)c.addIssue({code:'custom',message:'Event and summary must identify the same workspace'});});
export const signedEventClaimsSchema=z.object({...baseClaims,integration:z.literal('averidi-dashboard-events-v1'),event:dashboardEventSchema,nbf:unix.optional()}).strict().superRefine((v,c)=>{
 if(v.exp<=v.iat||v.exp-v.iat>300||v.jti!==v.event.eventId||v.sub!=='workspace:'+v.event.workspaceId||Date.parse(v.event.occurredAt)>v.iat*1000+10000)c.addIssue({code:'custom',message:'Invalid signed event binding/lifetime'});
});
export type ExternalIdentity=z.infer<typeof externalIdentitySchema>;
export type DashboardAdminAccess=z.infer<typeof dashboardAdminAccessSchema>;
export type DashboardSubscriptionDecision=z.infer<typeof subscriptionDecisionSchema>;
export type DashboardSubscriptionSummary=z.infer<typeof subscriptionSummarySchema>;
export type DashboardNavigation=z.infer<typeof navigationSchema>;
export type DashboardEvent=z.infer<typeof dashboardEventSchema>;
export type EcosystemClaims=z.infer<typeof ecosystemClaimsSchema>;
