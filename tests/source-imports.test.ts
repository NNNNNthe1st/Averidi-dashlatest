import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceImports} from '../scripts/verification/source-imports.mjs';
test('source isolation distinguishes actual imports from quoted repair templates',()=>{
 const source='import x from "./local"; export {y} from "./other"; const data=`import z from "../../analyst"`; const text="require(\\\"/outside\\\")"; const dynamic=import("../actual"); const loaded=require("./runtime");';
 assert.deepEqual(sourceImports(source),['./local','./other','../actual','./runtime']);
 assert.deepEqual(sourceImports('const value=import("@analyst/foreign")'),['@analyst/foreign']);
});
