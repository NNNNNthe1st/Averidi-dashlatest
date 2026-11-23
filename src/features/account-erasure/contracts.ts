import {z} from 'zod';
import path from 'node:path';
export const erasureId=z.string().uuid(),localId=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const erasureDecision=z.object({version:z.literal(1),requestId:erasureId,userId:localId,identityDigest:z.string().regex(/^[a-f0-9]{64}$/),workspaceIds:z.array(localId).max(1000),organizationIds:z.array(localId).max(1000),receiptHash:z.string().regex(/^[a-f0-9]{64}$/),requestedAt:z.iso.datetime()}).strict();
export type ErasureDecision=z.infer<typeof erasureDecision>;
export function erasureSettings(env:Partial<NodeJS.ProcessEnv>=process.env){
 if(env.DASHBOARD_ACCOUNT_ERASURE_ENABLED!=='true')return null;
 const key=env.DASHBOARD_ACCOUNT_ERASURE_KEY??'',raw=env.DASHBOARD_ACCOUNT_ERASURE_LEDGER_ROOT??'';
 if(!/^[a-fA-F0-9]{64}$/.test(key)||!path.isAbsolute(raw)||path.resolve(/* turbopackIgnore: true */ raw)!==raw||raw==='/'||raw.length<10)throw Error('ERASURE_NOT_CONFIGURED');
 const store=env.DASHBOARD_STORAGE_ROOT;
 if(store&&(raw===path.resolve(/* turbopackIgnore: true */ store)||raw.startsWith(path.resolve(/* turbopackIgnore: true */ store)+path.sep)||path.resolve(/* turbopackIgnore: true */ store).startsWith(raw+path.sep)))throw Error('ERASURE_NOT_CONFIGURED');
 const days=env.DASHBOARD_ACCOUNT_ERASURE_FINANCIAL_RETENTION_DAYS?.trim()||undefined;
 if(days!==undefined&&(!/^\d{1,5}$/.test(days)||Number(days)<1||Number(days)>36500))throw Error('ERASURE_NOT_CONFIGURED');
 return {key:Buffer.from(key,'hex'),root:raw,financialRetentionDays:days===undefined?null:Number(days)};
}
export function requireErasureSettings(){const settings=erasureSettings();if(!settings)throw Error('ERASURE_DISABLED');return settings;}
