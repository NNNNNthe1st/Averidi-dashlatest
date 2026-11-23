// Dashboard-owned ingestion implementation preserved from the Dashboard feature branch.
// Independent copy: no imports from the website or Averidi Analyst.
import ExcelJS from "exceljs-hardened";
import path from "path";
import { createHash } from "crypto";
import {dashboardMaxFileBytes} from './limits';
export {dashboardMaxFileBytes} from './limits';

export const DASHBOARD_MAX_ROWS=50000;
export const DASHBOARD_MAX_COLUMNS=100;
export const DASHBOARD_PREVIEW_ROWS=20;
export type DashboardCell=string|number|boolean|null;
export type DashboardRow=Record<string,DashboardCell>;
export type DashboardColumn={name:string;dataType:"NUMBER"|"DATE"|"BOOLEAN"|"TEXT"};
export type DashboardPreparedData={
  rows:DashboardRow[];
  rawRows:DashboardRow[];
  columns:DashboardColumn[];
  profile:Record<string,unknown>;
  preview:DashboardRow[];
  duplicateCount:number;
  contentHash:string;
};

export class DashboardIngestValidationError extends Error{
  constructor(message:string){super(message);this.name="DashboardIngestValidationError"}
}
export class DashboardWorksheetSelectionError extends DashboardIngestValidationError{
  constructor(public worksheets:string[]){super('This workbook contains multiple data worksheets. Choose one: '+worksheets.join(', ')+'.');this.name='DashboardWorksheetSelectionError';}
}

function decodeDatasetText(bytes:Buffer,label:string){
  let encoding='utf-8',start=0;
  if(bytes[0]===0xff&&bytes[1]===0xfe){encoding='utf-16le';start=2;}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){encoding='utf-16be';start=2;}
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(start)).replace(/^\uFEFF/,'');}
  catch{throw new DashboardIngestValidationError(`The ${label} text encoding is invalid. Save it as UTF-8 or UTF-16 with a byte-order mark.`);}
}
function csvDelimiter(text:string){
  const counts=new Map([[',',0],[';',0],['\t',0]]);let quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"')i++;else quoted=!quoted;}
    else if(!quoted){if(c==='\r'||c==='\n')break;if(counts.has(c))counts.set(c,counts.get(c)!+1);}
  }
  return [...counts].sort((a,b)=>b[1]-a[1])[0][0];
}
export type DashboardCsvDelimiter=","|";"|"\t";
function parseCsv(text:string,chosenDelimiter?:DashboardCsvDelimiter){
  const delimiter=chosenDelimiter??csvDelimiter(text);
  const rows:string[][]=[];let row:string[]=[];let cell="";let quoted=false;let closedQuote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++}
      else if(c==='"'){quoted=false;closedQuote=true}
      else cell+=c;
    }else if(c===delimiter){row.push(cell);cell="";closedQuote=false}
    else if(c==="\n"||c==="\r"){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell="";closedQuote=false}
    else if(c==='"'){
      if(cell.length||closedQuote)throw new DashboardIngestValidationError("The CSV contains a quote outside a quoted field.");
      quoted=true;
    }else{
      if(closedQuote)throw new DashboardIngestValidationError("The CSV contains characters after a closing quote.");
      cell+=c;
    }
  }
  if(quoted)throw new DashboardIngestValidationError("The CSV contains an unterminated quoted value.");
  if(cell.length||row.length||closedQuote){row.push(cell);rows.push(row)}
  return rows;
}

function scalar(value:unknown):DashboardCell{
  if(value===null||value===undefined)return null;
  if(value instanceof Date)return value.toISOString();
  if(typeof value==="number"||typeof value==="boolean"||typeof value==="string")return value;
  if(typeof value==='object'&&value&&'richText' in value&&Array.isArray(value.richText))return value.richText.map(part=>typeof part?.text==='string'?part.text:'').join('');
  if(typeof value==="object"&&value&&"result" in value)return scalar((value as {result?:unknown}).result);
  if(typeof value==="object"&&value&&"text" in value)return String((value as {text?:unknown}).text??"");
  return String(value);
}

function uniqueHeaders(values:unknown[]){
  if(values.length>DASHBOARD_MAX_COLUMNS)throw new DashboardIngestValidationError(`Dashboard datasets support at most ${DASHBOARD_MAX_COLUMNS} columns.`);
  const bases=values.map((value,index)=>String(scalar(value)??'').trim().replace(/\s+/g,' ')||`column_${index+1}`);
  const reserved=new Set(bases),used=new Set<string>();
  return bases.map(base=>{
    let name=base,n=2;
    while(used.has(name)){name=`${base}_${n++}`;while(reserved.has(name))name=`${base}_${n++}`;}
    used.add(name);return name;
  });
}

function normalizedNumeric(value:string){
  let s=value.trim();if(!s)return null;let negative=false;
  if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1)}
  const percent=/%$/.test(s);s=s.replace(/[\s,$£€¥₩₹]/g,"").replace(/%$/g,"");
  if(!/^[-+]?\d+(?:\.\d+)?$/.test(s))return null;
  let n=Number(s);if(!Number.isFinite(n))return null;if(negative)n=-Math.abs(n);return percent?n/100:n;
}

function normalizedBoolean(value:string){const s=value.trim().toLowerCase();if(["true","yes","y"].includes(s))return true;if(["false","no","n"].includes(s))return false;return null}
function safeDate(value:string){
  const s=value.trim();let y:number,m:number,d:number;
  let match=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(match){y=Number(match[1]);m=Number(match[2]);d=Number(match[3]);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString():null}
  match=s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if(match){y=Number(match[1]);m=Number(match[2]);d=Number(match[3]);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString():null}
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)){const t=Date.parse(s);return Number.isNaN(t)?null:new Date(t).toISOString()}
  return null;
}
function ambiguousDateLike(value:string){return /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}(?:\s.*)?$/.test(value.trim())}
/** Identifiers may contain leading zeroes and numeric-like characters. Do not infer them as amounts. */
function identifierHeader(name:string){return /(?:^|[\s_-])(?:id|identifier|code|sku|zip|zipcode|postal|postcode|phone|telephone|account_number|invoice_number|order_number|customer_number)(?:$|[\s_-])/i.test(name)||/(?:Id|ID|Code|SKU|Number)$/.test(name);}
function inferType(values:DashboardCell[]):DashboardColumn["dataType"]{
  const present=values.filter(v=>v!==null&&String(v).trim()!=="");if(!present.length)return "TEXT";
  const numeric=present.filter(v=>typeof v==="number"||(typeof v==="string"&&normalizedNumeric(v)!==null)).length;
  const bools=present.filter(v=>typeof v==="boolean"||(typeof v==="string"&&normalizedBoolean(v)!==null)).length;
  const ambiguous=present.filter(v=>typeof v==="string"&&ambiguousDateLike(v)).length;
  const dates=present.filter(v=>typeof v==="string"&&normalizedNumeric(v)===null&&safeDate(v)!==null).length;
  if(numeric/present.length>=.9)return "NUMBER";if(bools/present.length>=.95)return "BOOLEAN";if(!ambiguous&&dates/present.length>=.9)return "DATE";return "TEXT";
}
function parsedCalendarDate(year:number,month:number,day:number){
  if(year<1000||year>9999||month<1||month>12||day<1||day>31)return null;
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString():null;
}
type DateOrder="DMY"|"MDY";
function inferDateOrder(values:DashboardCell[]):DateOrder|null{
  let dayFirst=0,monthFirst=0;
  for(const value of values){
    if(typeof value!=="string")continue;
    const match=/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value.trim());
    if(!match)continue;
    const first=Number(match[1]),second=Number(match[2]),year=Number(match[3]);
    const dmy=parsedCalendarDate(year,second,first)!==null;
    const mdy=parsedCalendarDate(year,first,second)!==null;
    if(dmy&&!mdy)dayFirst++;
    if(mdy&&!dmy)monthFirst++;
  }
  return dayFirst>0&&monthFirst===0?"DMY":monthFirst>0&&dayFirst===0?"MDY":null;
}
function dateWithOrder(value:string,order:DateOrder|null){
  const iso=safeDate(value);
  if(iso)return iso;
  if(!order)return null;
  const match=/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value.trim());
  if(!match)return null;
  const first=Number(match[1]),second=Number(match[2]),year=Number(match[3]);
  return order==="DMY"?parsedCalendarDate(year,second,first):parsedCalendarDate(year,first,second);
}
function quantile(values:number[],q:number){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,l=Math.floor(p),u=Math.ceil(p);return l===u?a[l]:a[l]+(a[u]-a[l])*(p-l)}
function canonicalRow(row:DashboardRow,headers:string[]){return JSON.stringify(headers.map(h=>row[h]??null))}

function prepare(matrix:unknown[][],preserveTextFields:readonly string[]|"ALL"=[]):DashboardPreparedData{
  if(matrix.length<2)throw new DashboardIngestValidationError("The dataset needs a header row and at least one data row.");
  const headers=uniqueHeaders(matrix[0]);
  const raw=matrix.slice(1).filter(r=>r.some(v=>v!==null&&v!==undefined&&String(v).trim()!==""));
  if(!raw.length)throw new DashboardIngestValidationError('The dataset needs at least one non-empty data row.');
  if(raw.some(row=>row.length>headers.length))throw new DashboardIngestValidationError('A data row has more columns than the header row. Add the missing column names before uploading.');
  if(raw.length>DASHBOARD_MAX_ROWS)throw new DashboardIngestValidationError(`Dashboard datasets support at most ${DASHBOARD_MAX_ROWS} rows per version.`);
  const rows=raw.map(values=>Object.fromEntries(headers.map((h,i)=>[h,scalar(values[i])])) as DashboardRow);
  // Source text is business data, not formatting noise: never silently change it.
  // Original blank strings also remain distinct from missing/null values.
  const rawRows=rows.map(row=>({...row}));
  const dateOrders=new Map<string,DateOrder>();
  const uncertainDates:string[]=[];
  const columns:DashboardColumn[]=headers.map(name=>{
    const values=rows.map(row=>row[name]);
    const protectedText=identifierHeader(name)||values.some(value=>typeof value==="string"&&/^0[0-9]+$/.test(value))||preserveTextFields==="ALL"||preserveTextFields.includes(name);
    if(protectedText)return {name,dataType:"TEXT"};
    const present=values.filter(value=>value!==null&&String(value).trim()!=="");
    const dateLike=present.filter(value=>typeof value==="string"&&ambiguousDateLike(value));
    if(dateLike.length&&dateLike.length===present.length&&/(?:^|[\s_-])(date|dated)(?:$|[\s_-])/i.test(name)){
      const order=inferDateOrder(values);
      if(order&&present.every(value=>typeof value==="string"&&dateWithOrder(value,order)!==null)){
        dateOrders.set(name,order);
        return {name,dataType:"DATE"};
      }
      uncertainDates.push(name);
    }
    return {name,dataType:inferType(values)};
  });
  for(const h of headers)for(const row of rows){const v=row[h];if(typeof v==="string"&&v.trim()==="")row[h]=v;}
  for(const col of columns){
    for(const row of rows){const v=row[col.name];if(typeof v!=="string")continue;
      if(col.dataType==="NUMBER"){const n=normalizedNumeric(v);if(n!==null)row[col.name]=n}
      else if(col.dataType==="DATE"){const d=dateWithOrder(v,dateOrders.get(col.name)??null);if(d!==null)row[col.name]=d}
      else if(col.dataType==="BOOLEAN"){const b=normalizedBoolean(v);if(b!==null)row[col.name]=b}
    }
  }
  const seen=new Set<string>();let duplicateCount=0;
  for(const row of rows){const key=canonicalRow(row,headers);if(seen.has(key))duplicateCount++;else seen.add(key)}
  const fields:Record<string,unknown>=Object.create(null);
  for(const col of columns){
    const values=rows.map(r=>r[col.name]),present=values.filter(v=>v!==null),missing=values.length-present.length;
    const unique=new Set(present.map(v=>String(v))).size;
    const counts=new Map<string,number>();for(const value of present){const key=String(value);counts.set(key,(counts.get(key)||0)+1)}
    const info:Record<string,unknown>={dataType:col.dataType,present:present.length,missing,missingRate:values.length?missing/values.length:0,unique,uniqueRate:present.length?unique/present.length:0,topValues:[...counts].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([value,count])=>({value,count}))};
    if(col.dataType==="NUMBER"){const nums=present.map(Number).filter(Number.isFinite);info.min=nums.length?Math.min(...nums):null;info.max=nums.length?Math.max(...nums):null;info.median=quantile(nums,.5)}
    fields[col.name]=info;
  }
  const rawContentHash=createHash("sha256").update(JSON.stringify(rawRows)).digest("hex");
  const contentHash=createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const conversions=columns.map(column=>{
    let converted=0;
    for(let index=0;index<rows.length;index++){
      if(typeof rawRows[index][column.name]==="string"&&typeof rows[index][column.name]!=="string")converted++;
    }
    return {field:column.name,type:column.dataType,converted};
  }).filter(column=>column.converted>0);
  const provenance={rawContentHash,processedContentHash:contentHash,conversionSummary:conversions};
  return {rows,rawRows,columns,profile:{rowCount:rows.length,columnCount:columns.length,exactDuplicateRowsRetained:duplicateCount,fields,provenance,uncertainDateFields:uncertainDates},preview:rows.slice(0,DASHBOARD_PREVIEW_ROWS),duplicateCount,contentHash};
}

export function prepareDashboardRows(input:unknown,preserveTextFields:readonly string[]|"ALL"=[]):DashboardPreparedData{
  const rows=Array.isArray(input)?input:(input&&typeof input==="object"&&Array.isArray((input as {rows?:unknown}).rows)?(input as {rows:unknown[]}).rows:null);
  if(!rows||!rows.length)throw new DashboardIngestValidationError("JSON data must contain a non-empty array of row objects.");
  if(rows.length>DASHBOARD_MAX_ROWS)throw new DashboardIngestValidationError(`Dashboard datasets support at most ${DASHBOARD_MAX_ROWS} rows per version.`);
  if(!rows.every(row=>row&&typeof row==="object"&&!Array.isArray(row)))throw new DashboardIngestValidationError("Each JSON row must be an object.");
  const headers:string[]=[],seen=new Set<string>();
  for(const row of rows as Record<string,unknown>[])for(const rawKey of Object.keys(row)){
    const key=rawKey.trim();
    if(key&&!seen.has(key)){seen.add(key);headers.push(key)}
  }
  if(!headers.length)throw new DashboardIngestValidationError("JSON rows need at least one named field.");
  const matrix=(rows as Record<string,unknown>[]).map(row=>{
    const normalized=new Map<string,unknown>();
    for(const [rawKey,value] of Object.entries(row)){
      const key=rawKey.trim();
      if(!key)continue;
      if(normalized.has(key))throw new DashboardIngestValidationError("JSON row contains duplicate field names after trimming whitespace.");
      normalized.set(key,value);
    }
    return headers.map(header=>normalized.get(header));
  });
  return prepare([headers,...matrix],preserveTextFields);
}

export async function prepareDashboardFile(input:{bytes:Buffer;fileName:string;worksheetName?:string;csvDelimiter?:DashboardCsvDelimiter;preserveTextFields?:readonly string[];preserveAllText?:boolean}):Promise<DashboardPreparedData>{
  const {bytes,fileName,worksheetName}=input;
  const preserveTextFields=input.preserveAllText?"ALL":input.preserveTextFields;
  if(bytes.length<1||bytes.length>dashboardMaxFileBytes())throw new DashboardIngestValidationError(`Dataset files must be between 1 byte and ${Math.round(dashboardMaxFileBytes()/1024/1024)} MB.`);
  const ext=path.extname(fileName).toLowerCase();
  if(ext===".csv"){
    const text=decodeDatasetText(bytes,'CSV');
    if(text.includes('\0'))throw new DashboardIngestValidationError("The CSV contains binary data.");
    return prepare(parseCsv(text,input.csvDelimiter),preserveTextFields);
  }
  if(ext===".json"){
    const text=decodeDatasetText(bytes,'JSON');
    let parsed:unknown;try{parsed=JSON.parse(text)}catch{throw new DashboardIngestValidationError("The JSON file could not be parsed.")}
    return prepareDashboardRows(parsed,preserveTextFields);
  }
  if(ext===".xlsx"){
    const workbook=new ExcelJS.Workbook();
    const workbookBytes=bytes as unknown as Parameters<typeof workbook.xlsx.load>[0];
    try{await workbook.xlsx.load(workbookBytes)}catch(error){
      if(bytes.subarray(0,4).equals(Buffer.from([0xd0,0xcf,0x11,0xe0])))throw new DashboardIngestValidationError('This workbook is encrypted or uses an older Excel format. Save an unprotected .xlsx copy before uploading.');
      if(error instanceof Error&&/decompress|uncompressed.*limit/i.test(error.message))throw new DashboardIngestValidationError('This workbook expands beyond the Excel processing limit. Save the required data in a smaller workbook.');
      throw new DashboardIngestValidationError('The XLSX workbook could not be opened. Try saving a new unprotected .xlsx copy in Excel or LibreOffice.');
    }
    const sheets=workbook.worksheets.filter(sheet=>sheet.actualRowCount>=2);
    const sheet=worksheetName?sheets.find(item=>item.name===worksheetName):sheets.length===1?sheets[0]:undefined;
    if(!worksheetName&&sheets.length>1)throw new DashboardWorksheetSelectionError(sheets.map(item=>item.name));
    if(!sheet)throw new DashboardIngestValidationError("The workbook does not contain the requested worksheet.");
    // Retain original column positions; sparse Excel rows must not shift fields.
    const matrix:unknown[][]=[];
    sheet.eachRow({includeEmpty:false},row=>{
      if(row.cellCount>DASHBOARD_MAX_COLUMNS)throw new DashboardIngestValidationError("The worksheet exceeds the 100-column limit.");
      const values:unknown[]=[];
      for(let column=1;column<=Math.max(row.cellCount,1);column++)values.push(row.getCell(column).value);
      matrix.push(values);
      if(matrix.length>DASHBOARD_MAX_ROWS+1)throw new DashboardIngestValidationError("The worksheet exceeds the 50,000-row limit.");
    });
    return prepare(matrix,preserveTextFields);
  }
  throw new DashboardIngestValidationError("Averidi Dashboard accepts CSV, XLSX, or JSON data files.");
}

export function dashboardSafeFileName(name:string){return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g,"_").slice(0,120)||"dataset.csv"}
