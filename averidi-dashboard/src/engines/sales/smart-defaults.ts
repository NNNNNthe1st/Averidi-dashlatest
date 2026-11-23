import type {SalesAnswers,SalesField,SalesQuestion} from './contracts';

/**
 * Automatic-first setup.
 *
 * Most businesses export sales as final amounts (discounts and refunds already taken off, tax and
 * delivery excluded). Instead of blocking the first dashboard on technical questions, we apply the
 * common answer, detect what the data itself can tell us (date order, currency, number notation),
 * and show every assumption so the customer can change it later. Questions that need real business
 * input (targets, budgets, pipelines, multi-currency choices) are never answered automatically.
 */
export type SalesAssumption={key:SalesQuestion['key'];label:string;value:string};
export type SalesDefaultsContext={locale?:string;timeZone?:string};

const COMMON_YES:Partial<Record<SalesQuestion['key'],string>>={
 discountsAlreadyApplied:'Sales amounts already have discounts taken off',
 refundsAlreadyApplied:'Sales amounts already have refunds taken off (or there were none)',
 taxExcluded:'Sales amounts exclude sales tax',
 deliveryExcluded:'Sales amounts exclude delivery charges',
 recordedNet:'Recorded sales are final net amounts',
 costIsProductCost:'The cost column is the cost of the products or services sold',
 profitIsGross:'The profit column is gross profit (before overheads)',
 lineAmounts:'Each row holds its own item amounts',
 quantityNet:'Quantities already exclude returns',
 excludeSummaryRows:'Summary or total rows are left out',
 excludeNonSalesStatuses:'Only completed or paid orders count as sales',
 completedSalesPopulation:'Cancelled orders are not counted as sales',
 salesHistory:'The file includes every sale for the dates it covers',
 customerHistory:'The file includes each customer\'s purchases since their first one',
};

const SYMBOLS:[RegExp,string][]=[[/€/,'EUR'],[/£/,'GBP'],[/¥|JP¥/,'JPY'],[/₹/,'INR'],[/\bPKR\b|\bRs\.?\s?\d/i,'PKR'],[/\bAED\b/,'AED'],[/\bSAR\b/,'SAR'],[/\bCA\$|\bC\$/,'CAD'],[/\bA\$|\bAU\$/,'AUD'],[/₺|\bTRY\b/,'TRY'],[/\$/,'USD']];
const REGION_CURRENCY:Record<string,string>={US:'USD',GB:'GBP',PK:'PKR',IN:'INR',AE:'AED',SA:'SAR',CA:'CAD',AU:'AUD',TR:'TRY',JP:'JPY',DE:'EUR',FR:'EUR',ES:'EUR',IT:'EUR',NL:'EUR',IE:'EUR',ZA:'ZAR',NG:'NGN'};

export function detectCurrency(fields:readonly SalesField[],locale='en-US'):{code:string;fromData:boolean}{
 const text=fields.flatMap(f=>[f.name,...(f.examples??[])]).join(' ');
 for(const [pattern,code] of SYMBOLS)if(pattern.test(text))return {code,fromData:true};
 let region='US';try{region=new Intl.Locale(locale).maximize().region??'US';}catch{}
 return {code:REGION_CURRENCY[region]??'USD',fromData:false};
}

export function detectDateOrder(fields:readonly SalesField[],locale='en-US'):{order:'DAY_FIRST'|'MONTH_FIRST';fromData:boolean}{
 let dayFirst=0,monthFirst=0;
 for(const f of fields)for(const v of f.examples??[]){const m=/^\s*(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(v);if(!m)continue;const a=Number(m[1]),b=Number(m[2]);if(a>12&&b<=12)dayFirst++;else if(b>12&&a<=12)monthFirst++;}
 if(dayFirst!==monthFirst)return {order:dayFirst>monthFirst?'DAY_FIRST':'MONTH_FIRST',fromData:true};
 let region='US';try{region=new Intl.Locale(locale).maximize().region??'US';}catch{}
 return {order:['US','PH','CA','FM','PW','MH'].includes(region)?'MONTH_FIRST':'DAY_FIRST',fromData:false};
}

export function detectNumberFormat(fields:readonly SalesField[]):'DOT'|'COMMA'{
 let comma=0,dot=0;
 for(const f of fields)for(const v of f.examples??[]){if(/\d\.\d{3},\d{1,2}\b/.test(v)||/^\s*-?\d+,\d{1,2}\s*$/.test(v))comma++;else if(/\d,\d{3}\.\d{1,2}\b/.test(v)||/^\s*-?\d+\.\d{1,2}\s*$/.test(v))dot++;}
 return comma>dot?'COMMA':'DOT';
}

/** Suggested answers for unanswered questions. Never overrides an answer the customer already gave. */
export function suggestSalesAnswers(questions:readonly SalesQuestion[],fields:readonly SalesField[],existing:SalesAnswers,context:SalesDefaultsContext={}):{answers:SalesAnswers;assumptions:SalesAssumption[]}{
 const locale=context.locale??'en-US';const answers:SalesAnswers={};const assumptions:SalesAssumption[]=[];
 const set=(q:SalesQuestion,value:never,label:string)=>{(answers as Record<string,unknown>)[q.key]=value;assumptions.push({key:q.key,label:q.label,value:label});};
 for(const q of questions){
  if(q.optional||existing[q.key]!==undefined)continue;
  if(q.kind==='boolean'&&COMMON_YES[q.key]){set(q,true as never,COMMON_YES[q.key]!);continue;}
  if(q.kind==='dateformat'){const d=detectDateOrder(fields,locale);set(q,d.order as never,(d.order==='DAY_FIRST'?'Dates are day / month / year':'Dates are month / day / year')+(d.fromData?' (detected from your data)':' (based on your region)'));continue;}
  if(q.kind==='currency'){const c=detectCurrency(fields,locale);set(q,c.code as never,`Amounts are in ${c.code}`+(c.fromData?' (detected from your data)':' (based on your region)'));continue;}
  if(q.kind==='timezone'&&context.timeZone){set(q,context.timeZone as never,`Business timezone is ${context.timeZone} (from your browser)`);continue;}
  if(q.kind==='numberformat'){const n=detectNumberFormat(fields);set(q,n as never,n==='COMMA'?'Numbers use a comma for decimals (1.234,56)':'Numbers use a dot for decimals (1,234.56)');continue;}
  if(q.kind==='locale'){set(q,locale as never,`Month names are in ${locale}`);continue;}
  if(q.kind==='field'&&q.key==='transactionDateField'&&q.options?.length){const pick=q.options.find(o=>/order|invoice|transaction|sale/i.test(o))??q.options[0];set(q,pick as never,`Reporting uses the "${pick}" date`);continue;}
 }
 return {answers,assumptions};
}
