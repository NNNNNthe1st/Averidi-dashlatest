import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
test("Dashboard scripts, source, tests and migrations do not import another product",()=>{
 const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
 const output=execFileSync(process.execPath,["scripts/check-isolation.mjs"],{cwd,encoding:"utf8"});
 const report=JSON.parse(output);
 assert.equal(report.passed,true);
 assert.equal(report.violations.length,0);
 assert.ok(report.scanned>0);
});
