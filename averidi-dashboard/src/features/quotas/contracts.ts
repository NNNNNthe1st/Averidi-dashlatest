import {z} from 'zod';
export const quotaKeys=['seats','datasets','dashboards','connectors','reports','schedules','customMetrics','relationships','alerts','targets','teams','customRoles','shares','storedBytes'] as const;
export type QuotaKey=typeof quotaKeys[number];
// Missing/null is intentionally unlimited: commercial policy is explicitly authored, not inferred.
const limit=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const quotaSchema=z.object(Object.fromEntries(quotaKeys.map(key=>[key,limit.optional()])) as Record<QuotaKey,z.ZodOptional<typeof limit>>).strict();
export function quotaFailure(error:unknown):QuotaKey|null{
 const value=error instanceof Error?error.message:'';
 const meta=error&&typeof error==='object'&&'meta' in error?JSON.stringify(error.meta):'';
 const found=/DASHBOARD_QUOTA_EXCEEDED:([A-Za-z]+)/.exec(value+' '+meta)?.[1];
 return quotaKeys.includes(found as QuotaKey)?found as QuotaKey:null;
}
