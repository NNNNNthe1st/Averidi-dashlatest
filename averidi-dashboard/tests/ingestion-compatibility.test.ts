import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs-hardened';
import {prepareDashboardFile,DashboardIngestValidationError} from '../src/engines/ingestion/ingest';
const read=(bytes:Buffer,name='sample.csv')=>prepareDashboardFile({bytes,fileName:name});
test('Excel CSV encodings and conventional separators retain non-ASCII data',async()=>{
 const text='Product,Amount\r\n珈琲,100';
 for(const bytes of [Buffer.from(text),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text)]),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')]),Buffer.concat([Buffer.from([0xfe,0xff]),Buffer.from(text,'utf16le').swap16()])]){
  const result=await read(bytes);assert.equal(result.rows[0].Product,'珈琲');assert.equal(result.rows[0].Amount,100);
 }
 for(const text of ['Product;Amount\r\n珈琲;100','Product\tAmount\r\n珈琲\t100','Product,Amount\r珈琲,100']){
  const result=await read(Buffer.from(text));assert.equal(result.rows[0].Product,'珈琲');assert.equal(result.rows[0].Amount,100);
 }
});
test('quoted CSV preserves separators, multiline values, and escaped quotes',async()=>{
 const data=await read(Buffer.from('Product,Amount\n"Coffee, ""special""\nblend",100'));
 assert.equal(data.rows[0].Product,'Coffee, "special"\nblend');assert.equal(data.rows[0].Amount,100);
});
test('JSON accepts a UTF-8 BOM and supported row-wrapper shape',async()=>{
 const result=await read(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('{"rows":[{"Product":"珈琲","Amount":100}]}')]),'sample.JSON');
 assert.equal(result.rows[0].Product,'珈琲');
});
test('header deduplication cannot overwrite existing suffixed names',async()=>{
 const result=await read(Buffer.from('Amount,Amount,Amount_2\n1,2,3'));
 assert.equal(new Set(result.columns.map(c=>c.name)).size,3);
 assert.deepEqual(Object.values(result.rows[0]),[1,2,3]);
});
test('empty data and rows wider than the header are rejected without silent data loss',async()=>{
 await assert.rejects(read(Buffer.from('A,B\n,\n,\n')),DashboardIngestValidationError);
 await assert.rejects(read(Buffer.from('A,B\n1,2,3')),DashboardIngestValidationError);
 await assert.rejects(read(Buffer.from([0x41,0x0a,0xc3,0x28])),DashboardIngestValidationError);
});
test('rich-text Excel cells are imported as text; cached formula values and dates survive',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Data');sheet.addRow(['Name','Amount','Date']);
 sheet.addRow([{richText:[{text:'Coffee '},{text:'Sales',font:{bold:true}}]},{formula:'1+2',result:3},new Date('2026-01-01')]);
 const result=await read(Buffer.from(await book.xlsx.writeBuffer()),'sample.XLSX');
 assert.equal(result.rows[0].Name,'Coffee Sales');assert.equal(result.rows[0].Amount,3);assert.equal(result.rows[0].Date,'2026-01-01T00:00:00.000Z');
});
test('format and shape limits remain enforced',async()=>{
 await assert.rejects(read(Buffer.from('hello'),'sample.xls'),DashboardIngestValidationError);
 await assert.rejects(read(Buffer.from('A\n'+('1\n'.repeat(50001)))),DashboardIngestValidationError);
 await assert.rejects(read(Buffer.from(Array.from({length:101},(_,i)=>'c'+i).join(',')+'\n'+Array(101).fill('1').join(','))),DashboardIngestValidationError);
});
test('worksheet names with leading or trailing spaces identify the exact sheet',async()=>{
 const book=new ExcelJS.Workbook();
 for(const [name,value] of [['Sales',1],[' Sales ',2]] as const){const sheet=book.addWorksheet(name);sheet.addRow(['Amount']);sheet.addRow([value]);}
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const prepared=await prepareDashboardFile({bytes,fileName:'spaced.xlsx',worksheetName:' Sales '});
 assert.equal(prepared.rows[0].Amount,2);
});


test('numeric-looking identifiers and original text are not silently rewritten',async()=>{
 const data=await read(Buffer.from('customer_id,Product,Revenue\n00123,"  Coffee  blend ",100\n00045,"Line  one",200'));
 assert.equal(data.rows[0].customer_id,'00123');
 assert.equal(data.rows[1].customer_id,'00045');
 assert.equal(data.columns[0].dataType,'TEXT');
 assert.equal(data.rows[0].Product,'  Coffee  blend ');
 assert.equal(data.rows[0].Revenue,100);
});

test('leading zeroes are retained for numeric-looking identifiers',async()=>{
 const data=await read(Buffer.from('Reference,Amount\n00123,100\n00045,200'));
 assert.equal(data.columns[0].dataType,'TEXT');
 assert.equal(data.rows[0].Reference,'00123');
 assert.equal(data.rows[1].Reference,'00045');
 assert.equal(data.rows[0].Amount,100);
});
test('explicit customer field selection preserves numeric-looking text',async()=>{
 const data=await prepareDashboardFile({bytes:Buffer.from('Account,Revenue\n1234,100'),fileName:'sample.csv',preserveTextFields:['Account']});
 assert.equal(data.columns[0].dataType,'TEXT');
 assert.equal(data.rows[0].Account,'1234');
});

test('raw row representation retains source numeric text before analysis conversions',async()=>{
 const parsed=await read(Buffer.from('Revenue,Customer ID,Description\n$1234,00123,  retained  '));
 assert.equal(parsed.rawRows[0].Revenue,'$1234');
 assert.equal(parsed.rows[0].Revenue,1234);
 assert.equal(parsed.rawRows[0]['Customer ID'],'00123');
 assert.equal(parsed.rawRows[0].Description,'  retained  ');
});
test('explicit CSV delimiter is applied rather than inferred',async()=>{
 const data=await prepareDashboardFile({bytes:Buffer.from('Product;Revenue\nCoffee;120'),fileName:'data.csv',csvDelimiter:';'});
 assert.deepEqual(data.columns.map(c=>c.name),['Product','Revenue']);
 assert.equal(data.rows[0].Revenue,120);
});
test('Excel sparse column positions are not shifted into preceding columns',async()=>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Sparse');
 sheet.getCell('A1').value='Product';sheet.getCell('B1').value='Unused';sheet.getCell('C1').value='Revenue';
 sheet.getCell('A2').value='Coffee';sheet.getCell('C2').value=120;
 const data=await read(Buffer.from(await workbook.xlsx.writeBuffer()),'sparse.xlsx');
 assert.equal(data.rows[0].Product,'Coffee');
 assert.equal(data.rows[0].Unused,null);
 assert.equal(data.rows[0].Revenue,120);
});


test("detects date order from decisive values without changing raw date text",async()=>{
 const csv="Order Date,Order ID,Sales\n8/11/2016,CA-001,100\n19/11/2016,CA-002,200";
 const data=await prepareDashboardFile({bytes:Buffer.from(csv),fileName:"orders.csv"});
 assert.equal(data.columns.find(column=>column.name==="Order Date")?.dataType,"DATE");
 assert.equal(data.rows[0]["Order Date"],"2016-11-08T00:00:00.000Z");
 assert.equal(data.rawRows[0]["Order Date"],"8/11/2016");
 assert.equal(data.columns.find(column=>column.name==="Order ID")?.dataType,"TEXT");
});
test("leaves genuinely ambiguous dates as source text",async()=>{
 const csv="Order Date,Sales\n8/11/2016,100\n9/10/2016,200";
 const data=await prepareDashboardFile({bytes:Buffer.from(csv),fileName:"orders.csv"});
 assert.equal(data.columns[0].dataType,"TEXT");
 assert.deepEqual((data.profile as {uncertainDateFields:string[]}).uncertainDateFields,["Order Date"]);
 assert.equal(data.rows[0]["Order Date"],"8/11/2016");
});
