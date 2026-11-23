import {quotaHttpError} from '../quotas/http';
import {NextResponse} from 'next/server';
export const analysisHeaders={'Cache-Control':'private, no-store'};
export function analysisHttpError(error:unknown){const quota=quotaHttpError(error);if(quota)return quota;
 const message=error instanceof Error?error.message:'';
 const known=['FORBIDDEN','SUBSCRIPTION_REQUIRED','DATASET_UNAVAILABLE','VERSION_CONFLICT','CONFIRMATION_REQUIRED','STALE_ANALYSIS','INVALID_VIEW','NOT_FOUND','ANALYSIS_REQUIRED','INVALID_QUERY','TEMPLATE_UNAVAILABLE','METRIC_UNAVAILABLE','INVALID_WIDGET_DIMENSION','WIDGET_LIMIT','UNCONFIRMED_FILTER','CONFIRMED_TIMEZONE_REQUIRED','INVALID_DATE_VALUES','INVALID_CATEGORY_FILTER','COMPARISON_REQUIRES_ONE_DATE_RANGE','TOO_MANY_CHART_GROUPS','SOURCE_INTEGRITY_FAILURE','SOURCE_FORMAT_UNAVAILABLE','SUPERSEDED_ANALYSIS'];
 known.push('INVALID_COMPARISON_PERIOD','COMPARISON_PERIOD_TOO_SHORT');
 const code=known.includes(message)?message:'ANALYSIS_UNAVAILABLE';
 return NextResponse.json({error:code},{status:code==='FORBIDDEN'?403:code==='SUBSCRIPTION_REQUIRED'?402:['NOT_FOUND','DATASET_UNAVAILABLE'].includes(code)?404:['STALE_ANALYSIS','SUPERSEDED_ANALYSIS','VERSION_CONFLICT'].includes(code)?409:code==='ANALYSIS_UNAVAILABLE'?503:422,headers:analysisHeaders});
}
export async function analysisJson(request:Request,maxBytes=16384){
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID_QUERY');
 const chunks=[];let bytes=0;
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>maxBytes){await reader.cancel();throw Error('INVALID_QUERY');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const text=Buffer.concat(chunks).toString('utf8');
 try{return JSON.parse(text) as unknown;}catch{throw Error('INVALID_QUERY');}
}
