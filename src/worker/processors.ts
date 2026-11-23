import {processDatasetJoin} from './handlers/relationships';
import {processDatasetValidation,processDatasetTransformation,processSourceRefresh} from './handlers/datasets';
import {processDashboardGeneration,processAlertEvaluation} from './handlers/intelligence';
import {processReportGeneration,processReportDelivery} from './handlers/reports';
import {processDataCleanup} from './handlers/cleanup';
import type {Prisma} from '@prisma/client';
import {processDatasetAnalysisJob} from './dataset-analysis';
import {processDatasetProfileJob} from './dataset-profile';

export type DashboardProcessorJob={id:string;workspaceId:string;payload:unknown;leaseToken:string|null;deadlineAt?:number};
export type DashboardProcessor=(job:DashboardProcessorJob,signal?:AbortSignal)=>Promise<Prisma.InputJsonValue>;
/** Register only implemented Dashboard-owned processors; no fake success handlers. */
export const dashboardJobProcessors:Readonly<Record<string,DashboardProcessor>>=Object.freeze({
 DATASET_PROFILE:processDatasetProfileJob,
 DATASET_INGEST:processDatasetProfileJob,
 DATASET_VALIDATE:processDatasetValidation,
 DATASET_TRANSFORM:processDatasetTransformation,
 DATASET_JOIN:processDatasetJoin,
 METRICS_CALCULATE:processDatasetAnalysisJob,
 DASHBOARD_GENERATE:processDashboardGeneration,
 SOURCE_REFRESH:processSourceRefresh,
 ALERTS_EVALUATE:processAlertEvaluation,
 REPORT_GENERATE:processReportGeneration,
 REPORT_DELIVER:processReportDelivery,
 DATA_CLEANUP:processDataCleanup,
 DATASET_ANALYZE:processDatasetAnalysisJob,
});
export function supportedDashboardJobKinds(){return Object.keys(dashboardJobProcessors);}
export async function processDashboardJob(job:DashboardProcessorJob&{kind:string},signal?:AbortSignal){
 const processor=Object.prototype.hasOwnProperty.call(dashboardJobProcessors,job.kind)?dashboardJobProcessors[job.kind]:null;
 if(!processor)throw new Error('UNSUPPORTED_JOB_KIND');
 return processor(job,signal);
}
