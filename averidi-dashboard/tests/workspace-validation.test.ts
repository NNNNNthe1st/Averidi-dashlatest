import {test} from "node:test";
import assert from "node:assert/strict";
import { workspaceNameSchema } from "../src/features/workspaces/validation";
test("workspace names reject blank and oversized input",()=>{
 assert.equal(workspaceNameSchema.safeParse(" ").success,false);
 assert.equal(workspaceNameSchema.safeParse("x".repeat(121)).success,false);
 assert.equal(workspaceNameSchema.parse("  Example Business  "),"Example Business");
});
