import {z} from 'zod';
export const workspaceRenameSchema=z.object({name:z.string().trim().min(2).max(120)}).strict();
export const subscriptionChangeSchema=z.object({planCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),status:z.enum(['ACTIVE','PAST_DUE','CANCELED','INACTIVE']),currentPeriodEnd:z.string().datetime({offset:true}).nullable()}).strict().superRefine((v,c)=>{if(v.status==='ACTIVE'&&(!v.currentPeriodEnd||Date.parse(v.currentPeriodEnd)<=Date.now()))c.addIssue({code:'custom',message:'Active subscriptions require a future period end',path:['currentPeriodEnd']});});
export const supportCreateSchema=z.object({subject:z.string().trim().min(4).max(160),message:z.string().trim().min(8).max(4000)}).strict();
export const supportUpdateSchema=z.object({status:z.enum(['OPEN','IN_PROGRESS','RESOLVED','CLOSED']),expectedUpdatedAt:z.string().datetime({offset:true}),note:z.string().trim().min(8).max(2000)}).strict();
export {configurationChangeSchema} from './configuration';
export const accountErasureRecoverySchema=z.object({action:z.literal('RECONCILE_BILLING'),reason:z.string().trim().min(8).max(500)}).strict();
// This inventory covers the Dashboard-owned resource API; it does not implement a website UI.
export const adminOperationCatalog=[
 {path:'/api/admin/v1/overview',methods:{get:null}},
 {path:'/api/admin/v1/workspaces',methods:{get:null}},
 {path:'/api/admin/v1/workspaces/{workspaceId}',methods:{get:null,patch:'WorkspaceRename'}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/usage',methods:{get:null}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/subscription',methods:{get:null,put:'SubscriptionChange'}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/subscription/hold',methods:{put:'AccessHold'}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/billing',methods:{get:null,put:'BillingBinding'}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/billing/reconcile',methods:{post:null}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/billing/checkout',methods:{post:'CheckoutRecovery'}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/invoices',methods:{get:null}},
 {path:'/api/admin/v1/workspaces/{workspaceId}/datasets/{datasetId}/diagnostics',methods:{get:null}},
 {path:'/api/admin/v1/users',methods:{get:null}},
 {path:'/api/admin/v1/jobs',methods:{get:null}},
 {path:'/api/admin/v1/account-erasures',methods:{get:null}},
 {path:'/api/admin/v1/account-erasures/{requestId}',methods:{post:'AccountErasureRecovery'}},
 {path:'/api/admin/v1/mutations',methods:{get:null}},
 {path:'/api/admin/v1/audit',methods:{get:null}},
 {path:'/api/admin/v1/connectors',methods:{get:null}},
 {path:'/api/admin/v1/operations',methods:{get:null}},
 {path:'/api/admin/v1/plans',methods:{get:null,put:'PlanChange'}},
 {path:'/api/admin/v1/billing/events',methods:{get:null}},
 {path:'/api/admin/v1/support',methods:{get:null}},
 {path:'/api/admin/v1/support/{caseId}',methods:{get:null,patch:'SupportUpdate'}},
 {path:'/api/admin/v1/configuration',methods:{get:null,put:'ConfigurationChange'}},
] as const;
