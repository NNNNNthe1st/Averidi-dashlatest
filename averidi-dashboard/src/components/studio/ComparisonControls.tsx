'use client';
import {useEffect,useState} from 'react';
import {analysisQuerySchema,type AnalysisQuery} from '../../engines/analysis/query-contracts';
import type {ComparisonOptions} from '../../engines/metrics/comparison-periods';
const messages:Record<string,string>={INVALID_COMPARISON_PERIOD:'Choose valid current and comparison dates, and an observed-through date within the current range.',COMPARISON_PERIOD_TOO_SHORT:'The comparison range has fewer days than the observed current period. Choose a longer comparison range or an earlier observed-through date.'};
export function comparisonMessage(code:string){return messages[code]??code;}
export default function ComparisonControls({query,onChange,disabled}:{query:AnalysisQuery;onChange:(query:AnalysisQuery)=>void;disabled:boolean}){
 const [mode,setMode]=useState<ComparisonOptions['mode']>('PREVIOUS_PERIOD'),[start,setStart]=useState(''),[end,setEnd]=useState(''),[through,setThrough]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const c=query.comparison;setMode(c?.mode??'PREVIOUS_PERIOD');setStart(c?.mode==='CUSTOM'?c.start:'');setEnd(c?.mode==='CUSTOM'?c.end:'');setThrough(c?.through??'');setError('');},[query]);
 const dates=query.filters.filter(f=>f.type==='DATE_RANGE'),date=dates.length===1?dates[0]:null;
 function apply(){const comparison={mode,...(mode==='CUSTOM'?{start,end}:{}),...(through?{through}:{})};const parsed=analysisQuerySchema.safeParse({...query,compare:true,comparison});if(!parsed.success){setError('Complete valid comparison dates before applying.');return;}setError('');onChange(parsed.data);}
 return <details><summary>More comparison options</summary><p>Apply one date filter first. Month and year comparisons use matching calendar dates; a complete month compares with the complete preceding month. Review the displayed dates and day counts.</p>
 <fieldset disabled={disabled||!date}><legend>Comparison period</legend>
 <label>Compare with <select aria-label="Compare with" value={mode} onChange={e=>setMode(e.target.value as ComparisonOptions['mode'])}><option value="PREVIOUS_PERIOD">Previous period</option><option value="PREVIOUS_MONTH">Previous month</option><option value="PREVIOUS_YEAR">Previous year</option><option value="CUSTOM">Custom dates</option></select></label>
 {mode==='CUSTOM'?<><label>Comparison from <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Comparison through <input type="date" value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)}/></label></>:null}
 <label>Current data observed through (optional) <input type="date" value={through} min={date?.value} max={date?.end} onChange={e=>setThrough(e.target.value)}/></label>
 <p>Set this only when data is complete through that business-calendar date. Both periods then use the same elapsed number of days from their starts. Missing records do not establish data completeness.</p>
 <button type="button" onClick={apply}>Apply comparison</button>{' '}<button type="button" onClick={()=>onChange({filters:query.filters,compare:false})}>Remove comparison</button>
 </fieldset>{!date?<p>Comparison requires exactly one applied date range.</p>:null}{error?<p role="alert">{error}</p>:null}</details>;
}
