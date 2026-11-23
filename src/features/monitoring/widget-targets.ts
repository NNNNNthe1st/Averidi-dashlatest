import {targetPace} from '../../engines/metrics/target-pace';
import {dashboardDb as db} from '../../server/db';
import {workspacePolicy} from '../permissions/policy';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import type {AnalysisQuery} from '../../engines/analysis/pipeline';
import type {DashboardWidgetData} from '../../engines/visualization/widgets';
import type {DashboardTargetAnnotations} from './contracts';
const empty=():DashboardTargetAnnotations=>({items:[],hasMore:false});
/** Dataset-wide goals are annotated only for the exact single-date-field period, without category/group-filter substitution. */
export async function readWidgetTargets(actor:VerifiedDashboardActor,workspaceId:string,datasetId:string,query:AnalysisQuery,data:DashboardWidgetData):Promise<DashboardTargetAnnotations>{
 const period=query.filters.length===1&&query.filters[0].type==='DATE_RANGE'?query.filters[0]:null,dates=data.analysis.dimensions.filter(d=>d.role==='DATE');
 if(!period?.end||dates.length!==1||dates[0].field!==period.field)return empty();
 if(!(await workspacePolicy(actor.userId,workspaceId))?.permissions.includes('monitoring.read'))return empty();
 const ready=data.analysis.outcomes.filter(metric=>metric.status==='READY'&&metric.lineage.definitionVersion);if(!ready.length)return empty();
 const rows=await db.dashboardTarget.findMany({where:{workspaceId,datasetId,periodStart:new Date(period.value+'T00:00:00Z'),periodEnd:new Date(Date.parse(period.end+'T00:00:00Z')+86400000),OR:ready.map(metric=>({metric:{key:metric.key},definitionVersion:metric.lineage.definitionVersion!,currency:metric.definition.format==='CURRENCY'?metric.lineage.currency:null}))},orderBy:{id:'asc'},take:101,select:{direction:true,pacing:true,id:true,name:true,value:true,currency:true,metric:{select:{key:true}}}});
 if(!(await workspacePolicy(actor.userId,workspaceId))?.permissions.includes('monitoring.read'))return empty();
 return {items:rows.slice(0,100).map(row=>({id:row.id,name:row.name,metricKey:row.metric.key,value:String(row.value),currency:row.currency,start:period.value,through:period.end!,observedThrough:data.analysis.comparisonPeriods?.current.end??period.end!,...(row.direction?{pace:targetPace({value:ready.find(m=>m.key===row.metric.key)?.value??null,target:Number(row.value),start:period.value,through:period.end!,observedThrough:query.comparison?.through??null,direction:row.direction,pacing:row.pacing,metricKey:row.metric.key})}:{})})),hasMore:rows.length>100};
}
