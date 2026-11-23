import ExcelJS from "exceljs-hardened";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareDashboardRows, prepareDashboardFile, DashboardIngestValidationError } from "../src/engines/ingestion/ingest";

test("ingestion normalizes independent source rows", () => {
  const result = prepareDashboardRows([{Order:"A1",Revenue:125},{Order:"A2",Revenue:75}]);
  assert.equal(result.rows.length,2);
  assert.ok(result.contentHash.length>0);
  assert.equal(result.columns.length,2);
});

test("ingestion rejects an empty dataset", () => {
  assert.throws(() => prepareDashboardRows([]), DashboardIngestValidationError);
});

test("CSV pipeline preserves all rows and headers", async () => {
  const result = await prepareDashboardFile({bytes:Buffer.from("Order,Revenue\nA1,125\nA2,75\n"),fileName:"orders.csv"});
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.columns.map(x=>x.name),["Order","Revenue"]);
});

test("JSON ingestion preserves field values and rejects malformed payloads",async()=>{
 const valid=await prepareDashboardFile({bytes:Buffer.from(JSON.stringify([{id:"one",amount:12},{id:"two",amount:24}])),fileName:"data.json"});
 assert.equal(valid.rows.length,2);
 await assert.rejects(()=>prepareDashboardFile({bytes:Buffer.from("{invalid"),fileName:"data.json"}),DashboardIngestValidationError);
});
test("XLSX ingestion selects a worksheet explicitly when multiple contain data",async()=>{
 const workbook=new ExcelJS.Workbook();
 const first=workbook.addWorksheet("Sales");
 first.addRow(["Order","Revenue"]);first.addRow(["A1",125]);
 const second=workbook.addWorksheet("Costs");
 second.addRow(["Order","Cost"]);second.addRow(["A1",40]);
 const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
 await assert.rejects(()=>prepareDashboardFile({bytes,fileName:"tables.xlsx"}),DashboardIngestValidationError);
 const selected=await prepareDashboardFile({bytes,fileName:"tables.xlsx",worksheetName:"Costs"});
 assert.equal(selected.rows.length,1);
 assert.deepEqual(selected.columns.map(c=>c.name),["Order","Cost"]);
});
