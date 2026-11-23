import type {SourceQualityAssessment} from '../../features/data-model/source-quality';
export default function SourceQualitySummary({assessment,label='Source quality'}:{assessment:SourceQualityAssessment|undefined;label?:string}){
 if(!assessment)return null;
 const status=assessment.status==='PASS'?'Pass':assessment.status==='WARNING'?'Warning':assessment.status==='FAIL'?'Fail':'Not checked';
 return <section aria-label={label} style={{border:'1px solid #b8c6d4',borderRadius:8,padding:12,margin:'12px 0',overflowWrap:'anywhere'}}><p role="status"><strong>{label}: {status}</strong></p><p>{assessment.scope==='GOVERNED'?'Source profile and current governed checks.':'Source profile checks; business meaning and calculation checks may still be required.'} {assessment.rows!==null?`${assessment.rows} profiled source rows.`:''}</p>
  {assessment.status===null?<p>A ready, internally consistent source profile is required before showing a passing result.</p>:null}
  {assessment.errors.length?<ul>{assessment.errors.map(error=><li key={error.code}>{error.code==='DUPLICATE_ROWS'?error.count===undefined?'Repeated source rows require review.':`${error.count} identical repeated source rows require review.`:error.code==='INGESTION_FAILED'?'Source processing failed. Inspect the job result and upload or refresh a corrected source.':'Current validation failed. Review the detailed findings and correct the source or confirmed rules.'}</li>)}</ul>:null}
  {assessment.warnings.length?<><p>Missing cells may be intentional, but should be reviewed. Individual metrics retain their existing confirmation and validity safeguards.</p><ul>{assessment.warnings.map(warning=><li key={warning.field??'summary'}>{warning.field!==undefined&&warning.count!==undefined?`${warning.field}: ${warning.count} missing ${warning.count===1?'cell':'cells'}`:'Missing source cells require review. Ask a workspace member with data access to inspect the source.'}</li>)}</ul></>:null}
  <p>This describes detected findings in the profiled source version, across all its rows. A pass does not prove that an external source supplied every expected record.</p>
 </section>;
}
