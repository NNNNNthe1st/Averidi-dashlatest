import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs-hardened';
import {prepareDashboardFile,DashboardIngestValidationError} from '../src/engines/ingestion/ingest';
test('multi-sheet Excel requires an explicit sheet and selected sheet imports successfully',async()=>{
 const book=new ExcelJS.Workbook();
 for(const name of ['Sales','Inventory']){const sheet=book.addWorksheet(name);sheet.addRow(['Product','Amount']);sheet.addRow(['Example',10]);}
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 await assert.rejects(prepareDashboardFile({bytes,fileName:'example.xlsx'}),(error:unknown)=>error instanceof DashboardIngestValidationError&&error.message.includes('Sales')&&error.message.includes('Inventory'));
 const prepared=await prepareDashboardFile({bytes,fileName:'example.xlsx',worksheetName:'Sales'});
 assert.equal(prepared.rows.length,1);assert.equal(prepared.rows[0].Amount,10);
 await assert.rejects(prepareDashboardFile({bytes,fileName:'example.xlsx',worksheetName:'Wrong sheet'}),/requested worksheet/);
});
test('invalid CSV and JSON have specific validation reasons; valid data is accepted',async()=>{
 await assert.rejects(prepareDashboardFile({bytes:Buffer.from('a,b\n"unfinished'),fileName:'bad.csv'}),/unterminated quoted value/);
 await assert.rejects(prepareDashboardFile({bytes:Buffer.from('{invalid'),fileName:'bad.json'}),/could not be parsed/);
 await assert.rejects(prepareDashboardFile({bytes:Buffer.from('a,b'),fileName:'empty.csv'}),/header row and at least one data row/);
 assert.equal((await prepareDashboardFile({bytes:Buffer.from('a,b\nExample,10'),fileName:'valid.csv'})).rows.length,1);
 assert.equal((await prepareDashboardFile({bytes:Buffer.from('[{"a":"Example","b":10}]'),fileName:'valid.json'})).rows.length,1);
});
