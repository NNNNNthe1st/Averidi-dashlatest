import {z} from 'zod';
export const sourcePolicySchema=z.object({sourceId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),expectedRevision:z.number().int().nonnegative(),maxAgeMinutes:z.number().int().min(1).max(525600).nullable(),notifyFailures:z.boolean(),notifyMetricFailures:z.boolean()}).strict();
export const sourceIncidentAckSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),generation:z.number().int().positive()}).strict();
export const sourceIncidentMessages={
 SOURCE_REFRESH_FAILED:'The source could not be refreshed. The last successfully processed data has been retained. Review the connection or upload and retry.',
 SOURCE_AUTH_REQUIRED:'The source needs renewed authorization. Reconnect it before retrying the refresh.',
 METRIC_VALIDATION_FAILED:'Current metric calculation failed validation. Review field meanings, business rules and source quality before recalculating.',
 METRIC_REVIEW_REQUIRED:'The failed calculation has been superseded. Confirm and calculate the current data before this notification can clear.',
 METRIC_PROCESSING_FAILED:'Metric processing failed. Review the calculation job and retry after correcting the problem.',
 SOURCE_OVERDUE:'The source has passed your configured freshness limit. Refresh it or review its schedule.',
 SOURCE_NEVER_REFRESHED:'No successful refresh has been recorded within your configured freshness limit.',
} as const;
export function sourceFreshness(lastSyncedAt:Date|null,configuredAt:Date,maxAgeMinutes:number|null,now=new Date()){
 if(maxAgeMinutes===null)return {configured:false,stale:false,deadline:null};
 const baseline=lastSyncedAt??configuredAt,deadline=new Date(baseline.getTime()+maxAgeMinutes*60000);
 return {configured:true,stale:now>=deadline,deadline};
}
