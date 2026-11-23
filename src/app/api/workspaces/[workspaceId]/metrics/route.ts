import {quotaHttpError} from '../../../../../features/quotas/http';
import {NextResponse} from 'next/server';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {dataActor,headers} from '../../../../../features/data-model/http';
import {analysisJson} from '../../../../../features/analysis/http';
import {readCustomMetrics,mutateCustomMetric} from '../../../../../features/custom-metrics/service';
type Context={params:Promise<{workspaceId:string}>};
function customMetricError(e:unknown){const policy=quotaHttpError(e);if(policy)return policy;const code=e instanceof Error?e.message:'';const forbidden=code==='FORBIDDEN',missing=['NOT_FOUND','DATASET_UNAVAILABLE'].includes(code),conflict=['CUSTOM_METRIC_CONFLICT','CUSTOM_METRIC_PREVIEW_CHANGED','SUPERSEDED_ANALYSIS','STALE_ANALYSIS','VERSION_CONFLICT'].includes(code),invalid=['INVALID_CUSTOM_METRIC','INVALID_CUSTOM_FORMULA','CUSTOM_FORMULA_LIMIT','CUSTOM_METRIC_INPUT_UNAVAILABLE','CUSTOM_METRIC_UNIT_MISMATCH','CUSTOM_METRIC_ZERO_DENOMINATOR','CUSTOM_METRIC_RANGE','CUSTOM_METRIC_LIMIT','CUSTOM_METRIC_IN_USE','CUSTOM_METRIC_QUALITY_REQUIRED','CONFIRMATION_REQUIRED','INVALID_QUERY','UNCONFIRMED_FILTER','CONFIRMED_TIMEZONE_REQUIRED','INVALID_DATE_VALUES','INVALID_CATEGORY_FILTER'].includes(code);const status=forbidden?403:code==='SUBSCRIPTION_REQUIRED'?402:missing?404:conflict?409:invalid?422:503;return NextResponse.json({error:status===503?'CUSTOM_METRICS_UNAVAILABLE':code},{status,headers});}
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'analysis.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await readCustomMetrics(await dataActor(request),(await context.params).workspaceId,new URL(request.url).searchParams.get('datasetId')??undefined),{headers});}catch(e){return customMetricError(e);}
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'analysis.read');if(permissionDenied)return permissionDenied;
 try{return NextResponse.json(await mutateCustomMetric(await dataActor(request,true),(await context.params).workspaceId,await analysisJson(request)),{headers});}catch(e){return customMetricError(e);}
}
