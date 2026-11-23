export type OnboardingDataset={id:string;status:string;latestVersionId:string|null;pendingVersionId?:string|null;confirmedMappings:{sourceField:string;canonicalConcept:string}[];metricRules:Record<string,unknown>|null};
export type OnboardingAnalysis={datasetId:string;versionId:string;id:string;status:string;qualityPass:boolean;readyMetrics:boolean}|null;
export function onboardingProgress(dataset:OnboardingDataset|undefined,analysis:OnboardingAnalysis,views:{datasetId:string;analysisId?:string|null}[]){
 const profiled=dataset?.status==='READY'&&!!dataset.latestVersionId;
 const fields=!!profiled&&!!dataset?.confirmedMappings.length;
 const rules=fields&&!!dataset?.metricRules;
 const current=!!rules&&analysis?.datasetId===dataset?.id&&analysis?.versionId===dataset?.latestVersionId&&analysis?.status==='READY'&&analysis.qualityPass&&analysis.readyMetrics;
 return [
  {label:'Open your business workspace',done:true,target:'workspace-data',instruction:'Your workspace is ready.'},
  {label:'Add your business data',done:!!profiled,target:'workspace-data',instruction:dataset?.pendingVersionId?'Profiling is running. Check Jobs and schedules for progress.':'Upload a CSV, JSON or Excel file, or configure a connection.'},
  {label:'Check what your columns mean',done:fields,target:'field-meanings',instruction:"Check Averidi's suggested column meanings and save any necessary corrections."},
  {label:'Check calculation details',done:rules,target:'business-rules',instruction:'Confirm the details needed to calculate your business metrics accurately.'},
  {label:'Calculate available business metrics',done:!!current,target:'calculate-metrics',instruction:analysis&&!analysis.qualityPass?'Resolve the calculation quality issues, then calculate again.':'Use the existing analysis engine to calculate the metrics supported by your data.'},
  {label:'Build your dashboard',done:!!current&&views.some(v=>v.datasetId===dataset?.id&&v.analysisId===analysis?.id),target:'calculate-metrics',instruction:'Build your chosen dashboard from the available calculated results.'},
 ];
}
