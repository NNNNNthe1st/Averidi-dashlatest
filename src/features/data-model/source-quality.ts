import {z} from 'zod';
const count=z.number().int().min(0).max(50000);
const profileSchema=z.object({rowCount:count.min(1),columnCount:z.number().int().min(1).max(100),exactDuplicateRowsRetained:count,fields:z.record(z.string().min(1).max(120),z.object({present:count,missing:count}))});
export type SourceQualityAssessment={status:'PASS'|'WARNING'|'FAIL'|null;versionId:string|null;scope:'PROFILE'|'GOVERNED';rows:number|null;errors:{code:'DUPLICATE_ROWS'|'INGESTION_FAILED'|'GOVERNED_VALIDATION_FAILED'|'CURRENT_VALIDATION_FAILED';count?:number}[];warnings:{code:'MISSING_CELLS';field?:string;count?:number}[]};
/** Presentation of detected source findings only. It never changes metric eligibility or claims external source completeness. */
export function sourceQualityAssessment(input:{versionId?:string|null;status?:string;profile?:unknown;analysisStatus?:string|null;analysisQualityStatus?:string;validationFailed?:boolean;validationScope?:'PROFILE'|'GOVERNED'}):SourceQualityAssessment{
 const scope=input.analysisStatus||input.analysisQualityStatus||input.validationScope==='GOVERNED'?'GOVERNED' as const:'PROFILE' as const;
 const base:SourceQualityAssessment={status:null,versionId:input.versionId??null,scope,rows:null,errors:[],warnings:[]};
 if(input.status==='FAILED')return {...base,status:'FAIL',errors:[{code:'INGESTION_FAILED'}]};
 if(input.analysisStatus==='BLOCKED'||input.analysisQualityStatus==='FAIL')base.errors.push({code:'GOVERNED_VALIDATION_FAILED'});
 else if(input.validationFailed)base.errors.push({code:'CURRENT_VALIDATION_FAILED'});
 const parsed=profileSchema.safeParse(input.profile);
 if(input.status!=='READY'||!parsed.success)return {...base,status:base.errors.length?'FAIL':null};
 const profile=parsed.data,fields=Object.entries(profile.fields);
 if(fields.length!==profile.columnCount||profile.exactDuplicateRowsRetained>profile.rowCount||fields.some(([,field])=>field.present+field.missing!==profile.rowCount))return {...base,status:base.errors.length?'FAIL':null};
 base.rows=profile.rowCount;
 if(profile.exactDuplicateRowsRetained)base.errors.push({code:'DUPLICATE_ROWS',count:profile.exactDuplicateRowsRetained});
 base.warnings=fields.filter(([,field])=>field.missing>0).map(([field,value])=>({code:'MISSING_CELLS',field,count:value.missing}));
 return {...base,status:base.errors.length?'FAIL':base.warnings.length?'WARNING':'PASS'};
}

export function redactSourceQuality(assessment:SourceQualityAssessment):SourceQualityAssessment{return {...assessment,rows:null,errors:assessment.errors.map(error=>({code:error.code})),warnings:assessment.warnings.length?[{code:'MISSING_CELLS'}]:[]};}
