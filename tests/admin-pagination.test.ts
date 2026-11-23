import {test} from "node:test";
import assert from "node:assert/strict";
import {readAdminPage,adminPageResult} from "../src/server/admin-pagination";
test("admin pagination constrains page sizes and untrusted cursors",()=>{
 assert.equal(readAdminPage(new Request("https://test.local/admin"))?.limit,50);
 assert.equal(readAdminPage(new Request("https://test.local/admin?limit=101")),null);
 assert.equal(readAdminPage(new Request("https://test.local/admin?limit=1&limit=2")),null);
 assert.equal(readAdminPage(new Request("https://test.local/admin?limit=1.0")),null);
 assert.equal(readAdminPage(new Request("https://test.local/admin?limit=1e2")),null);
 assert.equal(readAdminPage(new Request("https://test.local/admin?cursor=a&cursor=b")),null);
 assert.equal(readAdminPage(new Request("https://test.local/admin?limit=-1")),null);
 assert.equal(readAdminPage(new Request("https://test.local/admin?cursor=bad%2Fid")),null);
 assert.deepEqual(adminPageResult([{id:"a"},{id:"b"}],1),{items:[{id:"a"}],nextCursor:"a"});
});
