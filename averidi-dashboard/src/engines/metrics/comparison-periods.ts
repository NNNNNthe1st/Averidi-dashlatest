import {z} from 'zod';
import {comparablePeriods} from './business-period';
const dayMs=86_400_000;
export function validCalendarDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
const date=z.string().refine(validCalendarDate,'Choose a valid calendar date.');
export const comparisonOptionsSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('PREVIOUS_PERIOD'),through:date.optional()}).strict(),
 z.object({mode:z.literal('PREVIOUS_MONTH'),through:date.optional()}).strict(),
 z.object({mode:z.literal('PREVIOUS_YEAR'),through:date.optional()}).strict(),
 z.object({mode:z.literal('CUSTOM'),start:date,end:date,through:date.optional()}).strict(),
]);
export type ComparisonOptions=z.infer<typeof comparisonOptionsSchema>;
type Range={start:string;end:string};
function range(start:string,end:string):Range{if(!validCalendarDate(start)||!validCalendarDate(end)||start>end)throw Error('INVALID_COMPARISON_PERIOD');return {start,end};}
const days=(r:Range)=>Math.round((Date.parse(r.end)-Date.parse(r.start))/dayMs)+1;
function fromDate(value:Date){const text=value.toISOString().slice(0,10);if(!validCalendarDate(text))throw Error('INVALID_COMPARISON_PERIOD');return text;}
function shift(value:string,months:number){
 const date=new Date(value+'T00:00:00Z'),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
 const last=new Date(date);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 date.setUTCDate(Math.min(day,last.getUTCDate()));return fromDate(date);
}
function previousMonth(current:Range){
 const first=current.start.endsWith('-01'),end=new Date(current.end+'T00:00:00Z'),next=new Date(end);next.setUTCDate(next.getUTCDate()+1);
 // A whole calendar month compares with the whole preceding month, including its actual last day.
 if(first&&current.start.slice(0,7)===current.end.slice(0,7)&&next.getUTCDate()===1){const start=shift(current.start,-1),last=new Date(current.start+'T00:00:00Z');last.setUTCDate(0);return range(start,fromDate(last));}
 return range(shift(current.start,-1),shift(current.end,-1));
}
/** Explicit calendar ranges: never infer observed-through dates from wall clock or missing records. */
export function resolveComparisonPeriods(start:string,end:string,options:ComparisonOptions={mode:'PREVIOUS_PERIOD'}){
 const selected=range(start,end);let current={...selected},previous:Range;
 if(options.mode==='PREVIOUS_PERIOD'){const value=comparablePeriods(start,end).previous;previous=range(value.start,value.end);}
 else if(options.mode==='PREVIOUS_MONTH')previous=previousMonth(selected);
 else if(options.mode==='PREVIOUS_YEAR')previous=range(shift(start,-12),shift(end,-12));
 else previous=range(options.start,options.end);
 const partial=!!options.through&&options.through<end;
 if(options.through){if(!validCalendarDate(options.through)||options.through<start||options.through>end)throw Error('INVALID_COMPARISON_PERIOD');current.end=options.through;}
 if(partial){
  const count=days(current);if(count>days(previous))throw Error('COMPARISON_PERIOD_TOO_SHORT');
  previous={...previous,end:fromDate(new Date(Date.parse(previous.start)+(count-1)*dayMs))};
 }
 return {mode:options.mode,current,previous,currentDays:days(current),previousDays:days(previous),partial,alignment:partial?'EQUAL_ELAPSED_DAYS' as const:'SELECTED_CALENDAR_RANGES' as const,overlap:current.start<=previous.end&&previous.start<=current.end};
}
export type ComparisonPeriods=ReturnType<typeof resolveComparisonPeriods>;
