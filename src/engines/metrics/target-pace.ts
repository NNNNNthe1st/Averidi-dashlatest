/** Pace is opt-in: uniform calendar-day accumulation is a customer assumption, never inferred from a goal. */
export const PACE_METRICS=new Set(['REVENUE','COST','PROFIT','ORDERS','UNITS','MARKETING_SPEND','ATTRIBUTED_CONVERSIONS','ATTRIBUTED_REVENUE','OPERATIONS_COMPLETED_TOTAL','OPERATIONS_LABOR_HOURS','OPERATIONS_ERRORS_TOTAL']);
export function targetPace(input:{value:number|null;target:number;start:string;through:string;observedThrough:string|null;direction:string|null;pacing:string;metricKey:string}){
 const unavailable=(description:string)=>({code:'UNAVAILABLE',label:'Target status unavailable',description,expected:null as number|null});
 const day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!day(input.start)||!day(input.through)||input.start>input.through||!input.observedThrough||!day(input.observedThrough)||input.observedThrough<input.start)return unavailable('Choose an explicit data-complete observed-through date in More comparison options.');
 if(!['HIGHER','LOWER'].includes(input.direction??'')||input.value===null||!Number.isFinite(input.value)||!Number.isFinite(input.target))return unavailable('Choose the target direction and use a confirmed metric.');
 const complete=input.observedThrough>=input.through;
 if(complete){const met=input.direction==='HIGHER'?input.value>=input.target:input.value<=input.target;return {code:met?'MET':'MISSED',label:met?'Target met':'Target missed',description:'Based on observed records through the target end; source completeness must be reviewed.',expected:input.target};}
 if(input.pacing!=='LINEAR'||!PACE_METRICS.has(input.metricKey)||input.target<=0)return unavailable('Choose uniform calendar-day pacing for an additive metric to assess an incomplete period.');
 const start=Date.parse(input.start),end=Date.parse(input.through),observed=Date.parse(input.observedThrough),fraction=(observed-start+86400000)/(end-start+86400000),expected=input.target*fraction;
 const delta=(input.value-expected)*(input.direction==='HIGHER'?1:-1),tolerance=Math.max(1,Math.abs(expected))*1e-9,code=Math.abs(delta)<=tolerance?'ON_TRACK':delta>0?'AHEAD':'BEHIND';
 return {code,label:code==='ON_TRACK'?'On track':code==='AHEAD'?'Ahead of pace':'Behind pace',description:'Compared with your chosen uniform calendar-day pace through '+input.observedThrough+'. This is observed progress, not a forecast or proof of complete source coverage.',expected};
}
