// Reuse identical timezone formatters; high-cardinality Sales charts otherwise
// construct thousands of Intl objects while evaluating the same source dates.
const calendarFormatters=new Map<string,Intl.DateTimeFormat>();
function calendarFormatter(timezone:string){
 const cached=calendarFormatters.get(timezone);if(cached)return cached;
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 if(calendarFormatters.size>=32)calendarFormatters.delete(calendarFormatters.keys().next().value!);
 calendarFormatters.set(timezone,formatter);return formatter;
}
/** Business calendar dates are not UTC dates. ISO date-only values retain
 * their supplied calendar day; timestamp instants use the workspace timezone. */
export function dashboardBusinessDay(value:unknown,timezone:string):string|null{
 if(typeof value!=="string")return null;
 if(!timezone)return null;
 let formatter:Intl.DateTimeFormat;try{formatter=calendarFormatter(timezone)}catch{return null}
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
  const d=new Date(value+"T00:00:00Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;
 }
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
 const parts=formatter.formatToParts(date);
 const get=(part:string)=>parts.find(p=>p.type===part)?.value;
 const y=get("year"),m=get("month"),d=get("day");
 return y&&m&&d?`${y}-${m}-${d}`:null;
}
export function dashboardInBusinessPeriod(value:unknown,timezone:string,start:string,end:string){
 const day=dashboardBusinessDay(value,timezone);
 return day!==null&&day>=start&&day<=end;
}

export function comparablePeriods(start:string,end:string):{current:{start:string;end:string};previous:{start:string;end:string}}{
 const a=new Date(start+"T00:00:00Z"),b=new Date(end+"T00:00:00Z");
 if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||a.toISOString().slice(0,10)!==start||b.toISOString().slice(0,10)!==end||a>b)throw new Error("Invalid comparison dates.");
 const duration=Math.round((b.getTime()-a.getTime())/86400000)+1;
 const priorEnd=new Date(a.getTime()-86400000),priorStart=new Date(priorEnd.getTime()-(duration-1)*86400000);
 return {current:{start,end},previous:{start:priorStart.toISOString().slice(0,10),end:priorEnd.toISOString().slice(0,10)}};
}
