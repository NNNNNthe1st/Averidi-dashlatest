import {inferRowGrain,type GrainSuggestion} from "./row-grain";
import type {DashboardRow,DashboardColumn} from "../ingestion/ingest";
export type DashboardSemanticDataset={rows:DashboardRow[];columns:DashboardColumn[];profile:Record<string,any>;transformations:[]};
type Role="DATE"|"METRIC"|"DIMENSION"|"IGNORE";
export type BusinessConcept="TIME"|"REVENUE"|"COST"|"PROFIT"|"QUANTITY"|"PRICE"|"RATE"|"ORDER"|"INVOICE"|"LINE_ITEM"|"CUSTOMER"|"PRODUCT"|"GEOGRAPHY"|"CHANNEL"|"CATEGORY"|"STATUS"|"IDENTIFIER"|"MEASURE"|"UNKNOWN";
export type SemanticField={sourceName:string;label:string;dataType:string;role:Role;semanticKey:string|null;businessConcept:BusinessConcept;unit:string|null;entity:string|null;confidence:number;reason:string};
export type BusinessOntology={version:1;datasetGrain:GrainSuggestion;primaryDate:string|null;entities:Array<{concept:string;field:string;confidence:number}>;measures:Array<{concept:string;field:string;aggregation:"sum"|"average";unit:string|null;confidence:number}>;relationships:Array<{from:string;relation:string;to:string;evidence:string}>;warnings:string[]};

const words=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
function label(name:string){return name.replace(/[_\-.]+/g," ").replace(/\b\w/g,c=>c.toUpperCase()).trim()}
function semanticKey(name:string){const n=words(name);const rules:Array<[RegExp,string]>=[
 [/^(date|transaction_date|order_date|sale_date|sales_date|invoice_date|created_at|timestamp)$/,"transaction_date"],
 [/^(sales|total_sales)$/,"revenue"],[/(revenue|net_sales|sales_amount|sales_value|turnover|amount_sold)/,"revenue"],
 [/(cost|cogs|cost_of_goods|expense)/,"cost"],[/(profit|gross_profit|net_profit|earnings)/,"profit"],
 [/(quantity|qty|units|units_sold)/,"quantity"],
 [/^(?:(?:order|invoice)_(?:line(?:_item)?|item)|line(?:_item)?)_(?:id|number)$/,"line_id"],
 [/^invoice_(?:id|number)$/,"invoice_id"],[/^order_(?:id|number)$/,"order_id"],
 [/^(transaction|receipt)_(?:id|number)$/,"transaction_id"],
 [/(customer_id|client_id|account_id|buyer_id)/,"customer_id"],[/(product_id|product|sku|item)/,"product"],
 [/(region|state|country|market|territory|city)/,"geography"],[/(channel|sales_channel|source)/,"channel"],
 [/(price|unit_price|selling_price)/,"price"],[/(margin|rate|ratio|percent|percentage|conversion_rate)/,"rate"],
 [/(category|segment|department|brand)/,"category"],[/(status|stage|state_name)/,"status"]
 ];return rules.find(([r])=>r.test(n))?.[1]??null}
function identifierLike(name:string,unique:number,rowCount:number){const n=words(name);return /(^id$|_id$|uuid|guid|email|phone|invoice_number|order_number|receipt_number|line_number|item_number)/.test(n)||(rowCount>=20&&unique/rowCount>.98&&/(code|number|key)$/.test(n))}
function concept(key:string|null,name:string,role:Role):BusinessConcept{if(role==="DATE")return"TIME";const n=key||words(name);if(n==="revenue")return"REVENUE";if(n==="cost")return"COST";if(n==="profit")return"PROFIT";if(n==="quantity")return"QUANTITY";if(n==="price")return"PRICE";if(n==="rate")return"RATE";if(n==="order_id")return"ORDER";if(n==="invoice_id")return"INVOICE";if(n==="line_id")return"LINE_ITEM";if(n==="transaction_id")return"IDENTIFIER";if(n==="customer_id")return"CUSTOMER";if(n==="product")return"PRODUCT";if(n==="geography")return"GEOGRAPHY";if(n==="channel")return"CHANNEL";if(n==="category")return"CATEGORY";if(n==="status")return"STATUS";if(role==="METRIC")return"MEASURE";if(/id|code|key|number/.test(words(name)))return"IDENTIFIER";return"UNKNOWN"}
function unitFor(name:string,key:string|null,profile:any){const n=words(name);if(key==="rate"||/(percent|percentage|pct|rate|margin)/.test(n))return"PERCENT";if(/usd|dollar/.test(n))return"USD";if(/eur|euro/.test(n))return"EUR";if(/gbp|pound/.test(n))return"GBP";if(/jpy|yen/.test(n))return"JPY";if(/kes|shilling/.test(n))return"KES";if(key&&["revenue","cost","profit","price"].includes(key))return"CURRENCY";if(key==="quantity")return"COUNT";if(profile?.min>=0&&profile?.max<=1&&/(ratio|rate|margin)/.test(n))return"PERCENT";return null}
function entityFor(c:BusinessConcept){return c==="ORDER"?"ORDER":c==="CUSTOMER"?"CUSTOMER":c==="PRODUCT"?"PRODUCT":c==="GEOGRAPHY"?"GEOGRAPHY":null}

export function inferSemanticModel(data:DashboardSemanticDataset):SemanticField[]{
 const profile=(data.profile.fields||{}) as Record<string,any>,dateColumns=data.columns.filter(c=>c.dataType==="DATE");
 const preferred=dateColumns.slice().sort((a,b)=>{const score=(n:string)=>/transaction|order|sale|invoice/.test(words(n))?4:/date/.test(words(n))?2:1;return score(b.name)-score(a.name)})[0]?.name;
 return data.columns.map(col=>{const p=profile[col.name]||{},key=semanticKey(col.name);let role:Role="DIMENSION",confidence=.78,reason="Context field inferred from type, name and observed values.";
  if(col.dataType==="DATE"&&col.name===preferred){role="DATE";confidence=.97;reason="Primary time field inferred from data type, field name and date coverage."}
  else if(col.dataType==="NUMBER"){if(identifierLike(col.name,p.unique||0,data.rows.length)){role="DIMENSION";confidence=.93;reason="Numeric identifier-like field; excluded from arithmetic metrics."}else{role="METRIC";confidence=key&&/revenue|cost|profit|quantity|price|rate/.test(key)?.97:.87;reason="Numeric measure supported by observed numeric values and non-identifier cardinality."}}
  else if(identifierLike(col.name,p.unique||0,data.rows.length)){role="DIMENSION";confidence=.94;reason="Identifier/context field retained for grouping and joins, not arithmetic."}
  const businessConcept=concept(key,col.name,role),unit=unitFor(col.name,key,p),entity=entityFor(businessConcept);
  return{sourceName:col.name,label:label(col.name),dataType:col.dataType,role,semanticKey:key,businessConcept,unit,entity,confidence,reason}
 })}
export function inferPeriodMode(data:DashboardSemanticDataset,fields:SemanticField[]){const date=fields.find(f=>f.role==="DATE");if(!date)return"SOURCE_FILE";const months=new Set<string>();for(const row of data.rows){const t=Date.parse(String(row[date.sourceName]??""));if(Number.isNaN(t))continue;const d=new Date(t);months.add(d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0"));if(months.size>1)return"DATE_FIELD"}return"SOURCE_FILE"}
function aggregation(field:SemanticField):"sum"|"average"{return field.businessConcept==="PRICE"||field.businessConcept==="RATE"?"average":"sum"}

export function inferBusinessOntology(data:DashboardSemanticDataset,fields:SemanticField[]):BusinessOntology{
 const warnings:string[]=[];
 const primaryDate=fields.find(f=>f.role==="DATE")?.sourceName??null;
 const datasetGrain=inferRowGrain(data.rows,fields);
 if(datasetGrain.kind==='UNDETERMINED')warnings.push('Row grain could not be determined safely; review the identity fields.');
 if(!primaryDate)warnings.push("No reliable primary date was inferred; time-based business reasoning is limited.");
 const entities=fields.filter(f=>f.entity).map(f=>({concept:f.entity!,field:f.sourceName,confidence:f.confidence}));
 const measures=fields.filter(f=>f.role==="METRIC").map(f=>({concept:f.businessConcept,field:f.sourceName,aggregation:aggregation(f),unit:f.unit,confidence:f.confidence}));
 const concepts=new Set(fields.map(f=>f.businessConcept)),relationships:BusinessOntology["relationships"]=[];
 const rel=(from:string,relation:string,to:string,e:string)=>relationships.push({from,relation,to,evidence:e});
 if(concepts.has("REVENUE")&&concepts.has("COST"))rel("REVENUE","is compared with","COST","Both governed measures are present; their difference may be relevant to profitability but no formula is assumed.");
 if(concepts.has("PROFIT")&&concepts.has("REVENUE"))rel("PROFIT","is evaluated relative to","REVENUE","Both profit and revenue measures are present; margin-like reasoning may be possible after formula validation.");
 if(concepts.has("PRICE")&&concepts.has("QUANTITY")&&concepts.has("REVENUE"))rel("PRICE","interacts with QUANTITY in","REVENUE","Price, quantity and revenue are all observed; decomposition can be tested without assuming revenue equals price × quantity.");
 if(concepts.has("CUSTOMER")&&concepts.has("REVENUE"))rel("CUSTOMER","contributes to","REVENUE","Customer identity and revenue are both present, enabling governed customer contribution analysis.");
 if(concepts.has("PRODUCT")&&concepts.has("REVENUE"))rel("PRODUCT","contributes to","REVENUE","Product identity and revenue are both present, enabling governed product contribution analysis.");
 return{version:1,datasetGrain,primaryDate,entities,measures,relationships,warnings}
}
