import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardSameOrigin } from "../src/server/request-origin";

const writeRoutes:Record<string,readonly string[]>={
  "src/app/api/workspaces/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/route.ts":["PATCH"],
  "src/app/api/workspaces/[workspaceId]/members/[userId]/route.ts":["PATCH","DELETE"],
  "src/app/api/workspaces/[workspaceId]/invitations/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/invitations/[invitationId]/route.ts":["DELETE"],
  "src/app/api/invitations/accept/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/datasets/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/versions/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/rollback/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/datasets/preview/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/confirm-fields/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/confirm-metric-rules/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/views/route.ts":["POST"],
  "src/app/api/workspaces/[workspaceId]/views/[viewId]/route.ts":["PATCH"],
};

test("every workspace or invitation write route enforces the existing origin boundary",()=>{
  for(const [file,methods] of Object.entries(writeRoutes)){
    const content=readFileSync(file,"utf8");
    assert.match(content,/import\s*\{\s*dashboardSameOrigin\s*\}/,file);
    for(const method of methods){
      const signature=new RegExp("export async function "+method+"\\(request:\\s*Request[^)]*\\)\\s*\\{");
      const match=signature.exec(content);
      assert.ok(match,file+" "+method+" missing");
      const firstCode=content.slice(match.index+match[0].length,match.index+match[0].length+500);
      assert.match(firstCode,/dashboardSameOrigin\(request\)/,file+" "+method+" origin check missing");
    }
  }
});

test("request origin policy rejects cross-site and missing-origin mutations",()=>{
  const previous=process.env.DASHBOARD_PUBLIC_ORIGIN;
  process.env.DASHBOARD_PUBLIC_ORIGIN="https://dashboard.example.test";
  try{
    const request=(origin:string|null,site="same-origin")=>new Request("https://dashboard.example.test/dashboard/app/api/workspaces",{method:"POST",headers:{
      ...(origin?{origin}:{}),"sec-fetch-site":site,
    }});
    assert.equal(dashboardSameOrigin(request("https://dashboard.example.test")),true);
    assert.equal(dashboardSameOrigin(request("https://other.example.test")),false);
    assert.equal(dashboardSameOrigin(request(null)),false);
    assert.equal(dashboardSameOrigin(request("https://dashboard.example.test","cross-site")),false);
  } finally {
    if(previous===undefined)delete process.env.DASHBOARD_PUBLIC_ORIGIN;
    else process.env.DASHBOARD_PUBLIC_ORIGIN=previous;
  }
});
