import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
test("Dashboard administrative audit persists independently",async()=>{
 const id=randomUUID();
 const row=await dashboardDb.dashboardAdminAudit.create({data:{id,actorIssuer:"test-issuer",actorSubject:"test-admin",action:"TEST_AUDIT"},select:{id:true,action:true}});
 try{
  assert.equal(row.action,"TEST_AUDIT");
  const stored=await dashboardDb.dashboardAdminAudit.findUnique({where:{id}});
  assert.equal(stored?.actorSubject,"test-admin");
 }finally{await dashboardDb.dashboardAdminAudit.delete({where:{id}});}
});
