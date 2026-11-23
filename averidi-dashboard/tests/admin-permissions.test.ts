import {test} from "node:test";
import assert from "node:assert/strict";
import {allowsDashboardAdminPermission as can} from "../src/server/admin-permissions";
test("administrative grants are explicitly scoped and reject extra roles",()=>{
 assert.equal(can(["dashboard:read"],"dashboard:read"),true);
 assert.equal(can(["dashboard:read"],"dashboard:manage"),false);
 assert.equal(can(["dashboard:manage"],"dashboard:read"),true);
 assert.equal(can(["dashboard:manage"],"dashboard:manage"),true);
 for(const value of [null,"dashboard:manage",[],["OWNER"],["dashboard:manage","website:admin"],[42]])assert.equal(can(value,"dashboard:manage"),false);
});
