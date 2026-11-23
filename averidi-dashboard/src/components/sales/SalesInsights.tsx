'use client';
import {useEffect,useRef} from 'react';
import type {SalesDashboardData} from './contracts';
import {salesRecoveryTarget,salesRecoveryLabel,type SalesAvailability} from '../../engines/sales/availability';
import {isSalesMetric,salesMetricText} from '../../engines/sales/contracts';
export default function SalesInsights({data,locale='en',onClose,setupUrl,canExport=false,onExport,onChangeFilters,highContrast=false,onContrastChange}:{data:SalesDashboardData|null;locale?:string;onClose:()=>void;setupUrl?:string;canExport?:boolean;onExport?:()=>void;onChangeFilters?:(clear:boolean)=>void;highContrast?:boolean;onContrastChange?:(value:boolean)=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 const ready=data?.analysis.outcomes.filter(m=>isSalesMetric(m.key)&&m.status==='READY')??[];
 const blocked=data?.analysis.outcomes.filter(m=>isSalesMetric(m.key)&&m.status!=='READY')??[];
 const currency=data?.analysis.outcomes.find(m=>m.key==='REVENUE')?.lineage.currency??null;
 return <dialog ref={ref} aria-labelledby="sales-insights-title" onCancel={onClose} onClose={onClose} style={{width:'min(900px,90vw)',maxHeight:'85vh',overflow:'auto',padding:24,fontFamily:'system-ui,sans-serif',fontSize:14,lineHeight:1.6,color:'#17324d',border:'1px solid #d8e3ed',borderRadius:12}}>
  <button onClick={onClose} style={{float:'right'}}>Close insights</button><h2 id="sales-insights-title">Sales insights</h2><p>These results use the dashboard’s current filters. Missing inputs remain visible below with their specific requirements.</p>
  <p>{onContrastChange?<label><input type="checkbox" checked={highContrast} onChange={e=>onContrastChange(e.target.checked)}/> Use higher contrast for Sales charts and controls</label>:null}</p><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Result</th><th>Value</th></tr></thead><tbody>{ready.map(m=><tr key={m.key}><th scope="row">{m.definition.label}</th><td>{salesMetricText(m,locale,currency)}</td></tr>)}{data?.customMeasures?.map(m=><tr key={m.id}><th scope="row">{m.name}<small style={{display:'block',fontWeight:400}}>{m.aggregation.toLowerCase().replaceAll('_',' ')} · {m.field}</small></th><td>{m.status==='READY'?new Intl.NumberFormat(locale,m.format==='CURRENCY'&&currency?{style:'currency',currency}:m.format==='PERCENT'?{style:'percent',maximumFractionDigits:2}:{maximumFractionDigits:2}).format(m.value!):m.reason}</td></tr>)}</tbody></table>
  {canExport&&onExport?<button onClick={onExport}>Export current results</button>:null}{setupUrl?<p><a href={setupUrl}>Review source fields, business details, and additional measures</a></p>:null}<details><summary>Other Sales results and their requirements ({blocked.length})</summary>{blocked.map(m=><p key={m.key}><strong>{m.definition.label}:</strong> {data?.availability?.[m.key]?.message??m.reason} {data?.availability?.[m.key]?.action==='CHANGE_FILTERS'&&onChangeFilters?<button onClick={()=>onChangeFilters(data.availability![m.key].kind==='NO_MATCHING_ROWS')}>{data.availability[m.key].kind==='NO_MATCHING_ROWS'?'Clear filters':'Choose reporting dates'}</button>:setupUrl&&data?.availability?.[m.key]?<a href={setupUrl+'#'+salesRecoveryTarget[data.availability[m.key].action]}>{salesRecoveryLabel[data.availability[m.key].action]}</a>:null}</p>)}</details>
 </dialog>;
}
