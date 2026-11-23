import {dashboardDb as db} from '../../server/db';
import {sourceQualityAssessment} from './source-quality';
type Input=Parameters<typeof sourceQualityAssessment>[0]&{workspaceId:string;datasetId:string;semanticRevision?:number;checksum?:string};
/** Use the same current-check scope on every surface, including failures outside the paginated review history. */
export async function currentSourceQuality(input:Input){
 let validationFailed=Boolean(input.validationFailed),validationScope=input.validationScope;
 if(input.status==='READY'&&input.versionId&&input.semanticRevision!==undefined&&input.checksum){
  const failure=await db.dashboardQualityCheck.findFirst({where:{workspaceId:input.workspaceId,datasetId:input.datasetId,versionId:input.versionId,status:'FAIL',AND:[{rule:{path:['semanticRevision'],equals:input.semanticRevision}},{rule:{path:['sourceChecksum'],equals:input.checksum}}]},select:{id:true,rule:true}});
  validationFailed ||=!!failure;const rule=failure?.rule;if(rule&&typeof rule==='object'&&!Array.isArray(rule))validationScope=rule.scope==='GOVERNED'?'GOVERNED':'PROFILE';
 }
 return sourceQualityAssessment({...input,validationFailed,validationScope});
}
