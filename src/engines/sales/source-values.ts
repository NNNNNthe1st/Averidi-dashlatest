import {sameDecimal} from './decimal-values';
import type {DashboardPreparedData} from '../ingestion/ingest';
import type {SalesAnswers,SalesField,SalesProjection,SalesQuestion} from './contracts';
const digitCache=new Map<string,[string,string][]>();
const monthCache=new Map<string,Map<string,number>>();
const monthKey=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[.,]/g,'').trim().replace(/^de | de$/g,'');
function monthsFor(locale:string){
 const cached=monthCache.get(locale);if(cached)return cached;
 const months=new Map<string,number>();
 for(const language of new Set(['en',locale]))for(const width of ['long','short'] as const){
  const formatter=new Intl.DateTimeFormat(language,{month:width,calendar:'gregory',timeZone:'UTC'});
  const contextual=new Intl.DateTimeFormat(language,{day:'numeric',month:width,calendar:'gregory',timeZone:'UTC'});
  for(let i=0;i<12;i++){const date=new Date(Date.UTC(2024,i,1));months.set(monthKey(formatter.format(date)),i+1);const month=contextual.formatToParts(date).find(p=>p.type==='month')?.value;if(month)months.set(monthKey(month),i+1);}
 }
 if(monthCache.size>=32)monthCache.delete(monthCache.keys().next().value!);monthCache.set(locale,months);return months;
}
export function salesCalendar(value:unknown,order:'DAY_FIRST'|'MONTH_FIRST',locale='en'):string|null{
 if(typeof value!=='string')return null;
 let text=value.normalize('NFKC').trim();
 let digits=digitCache.get(locale);if(!digits){const formatter=new Intl.NumberFormat(locale,{useGrouping:false});digits=Array.from({length:10},(_,i)=>[formatter.format(i),String(i)] as [string,string]).filter(([a,b])=>a!==b);if(digitCache.size>=32)digitCache.delete(digitCache.keys().next().value!);digitCache.set(locale,digits);}
 for(const [local,ascii] of digits)text=text.replaceAll(local,ascii);
 const yearFirst=/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
 const parts=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
 const dayNamed=/^(\d{1,2})[\s/.-]+(.+?)[\s,/.-]+(\d{4})$/.exec(text);
 const monthNamed=/^(.+?)\s+(\d{1,2})[,\s]+(\d{4})$/.exec(text);
 let year:string,month:string,day:string;
 if(yearFirst)[,year,month,day]=yearFirst;
 else if(parts){year=parts[3];[day,month]=order==='DAY_FIRST'?[parts[1],parts[2]]:[parts[2],parts[1]];}
 else{const named=dayNamed??monthNamed;if(!named)return null;const monthValue=monthsFor(locale).get(monthKey(dayNamed?named[2]:named[1]));if(!monthValue)return null;year=named[3];day=dayNamed?named[1]:named[2];month=String(monthValue);}
 const iso=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`,date=new Date(iso+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
}
export function salesNumber(value:unknown,decimal:'DOT'|'COMMA'):number|null{
 if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string')return null;
 let text=value.trim().replace(/[\u00a0\u202f ]/g,'');const negative=/^\(.*\)$/.test(text);if(negative)text=text.slice(1,-1);
 const pattern=decimal==='COMMA'?/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/:/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
 if(!pattern.test(text))return null;const normalized=(negative?'-':'')+(decimal==='COMMA'?text.replaceAll('.','').replace(',','.'):text.replaceAll(',',''));const number=Number(normalized);return Number.isFinite(number)&&sameDecimal(normalized,number)?number:null;
}
export function salesSourceProjection(data:DashboardPreparedData,fields:SalesField[],answers:SalesAnswers,locale=answers.dateLocale??'en'){
 const projection:SalesProjection={},questions:SalesQuestion[]=[];
 for(const f of fields.filter(f=>['TIME','SALES_OPPORTUNITY_OPENED','SALES_OPPORTUNITY_CLOSED'].includes(f.role))){
  const raw=data.rawRows.map(r=>r[f.name]);
  if(!raw.length)continue;
  if(!raw.every(v=>salesCalendar(v,'DAY_FIRST',locale)!==null||salesCalendar(v,'MONTH_FIRST',locale)!==null)){if(f.type!=='DATE'&&raw.every(v=>typeof v==='string'&&/[\p{L}]/u.test(v)&&/\p{Nd}{4}/u.test(v))&&!answers.dateLocale&&!questions.some(q=>q.key==='dateLocale'))questions.push({key:'dateLocale',kind:'locale',label:'Which language or region is used for the written month names?',detail:'Choose the source date language, such as French (fr-FR), German (de-DE) or Spanish (es-ES). Dates are checked across the complete column before use.'});continue;}
  const day=raw.every(v=>salesCalendar(v,'DAY_FIRST',locale)!==null),month=raw.every(v=>salesCalendar(v,'MONTH_FIRST',locale)!==null);
  const equivalent=day&&month&&raw.every(v=>salesCalendar(v,'DAY_FIRST',locale)===salesCalendar(v,'MONTH_FIRST',locale));
  const selected=answers.dateFormat??(equivalent?'DAY_FIRST':day&&!month?'DAY_FIRST':month&&!day?'MONTH_FIRST':null);
  if(selected&&raw.every(v=>salesCalendar(v,selected,locale)!==null))(projection.dateFields??=[]).push({field:f.name,order:selected,locale});
  else if(day&&month){(projection.blockedFields??=[]).push(f.name);if(!questions.some(q=>q.key==='dateFormat'))questions.push({key:'dateFormat',kind:'dateformat',label:`In “${f.name}”, does 03/04 mean 3 April or March 4?`,detail:'Both interpretations are possible. Choose the date order used in this file.'});}
 }
 const numeric=new Set(['REVENUE','COST','UNIT_COST','PRICE','PROFIT','QUANTITY','DISCOUNT','DISCOUNT_RATE','TAX','SHIPPING','GROSS','REFUND','RETURN_QUANTITY']);
 for(const f of fields.filter(f=>numeric.has(f.role)||answers.customMeasures?.some(m=>m.field===f.name&&!['COUNT','DISTINCT_COUNT'].includes(m.aggregation)))){
  const raw=data.rawRows.map(r=>r[f.name]);if(!raw.length||!raw.every(v=>typeof v==='number'||typeof v==='string'&&/^[\d.,() +\-\u00a0\u202f]+$/.test(v)))continue;
  const comma=raw.every(v=>salesNumber(v,'COMMA')!==null),dot=raw.every(v=>salesNumber(v,'DOT')!==null);
  const different=comma&&dot&&raw.some(v=>salesNumber(v,'COMMA')!==salesNumber(v,'DOT'));
  const selected=answers.numberFormat??(comma&&!dot?'COMMA':dot&&!comma?'DOT':null);
  if(selected&&raw.every(v=>salesNumber(v,selected)!==null))(projection.numericFields??=[]).push({field:f.name,decimal:selected});
  else if(different){(projection.blockedFields??=[]).push(f.name);if(!questions.some(q=>q.key==='numberFormat'))questions.push({key:'numberFormat',kind:'numberformat',label:'Which number format does this file use?',detail:'Some values could be decimal amounts or grouped thousands. Choose the notation used by the source.'});}
 }
 return {projection,questions};
}
