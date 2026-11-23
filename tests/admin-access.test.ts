import {test} from "node:test";
import assert from "node:assert/strict";
import {authorizeDashboardAdmin} from "../src/server/admin-access";

test("Dashboard admin denies unsigned requests and workspace-role impersonation",async()=>{
 const previous={
  DASHBOARD_ADMIN_OIDC_ISSUER:process.env.DASHBOARD_ADMIN_OIDC_ISSUER,
  DASHBOARD_ADMIN_OIDC_AUDIENCE:process.env.DASHBOARD_ADMIN_OIDC_AUDIENCE,
  DASHBOARD_ADMIN_OIDC_JWKS_URL:process.env.DASHBOARD_ADMIN_OIDC_JWKS_URL,
 };
 try{
  delete process.env.DASHBOARD_ADMIN_OIDC_ISSUER;
  delete process.env.DASHBOARD_ADMIN_OIDC_AUDIENCE;
  delete process.env.DASHBOARD_ADMIN_OIDC_JWKS_URL;
  const request=new Request("https://dashboard.test/api/admin/v1/overview",{
   headers:{"x-dashboard-role":"OWNER","cookie":"sbr_session=forged","authorization":"Bearer forged"}
  });
  assert.equal(await authorizeDashboardAdmin(request,"dashboard:read"),null);
  assert.equal(await authorizeDashboardAdmin(request,"dashboard:manage"),null);
 }finally{
  for(const [k,v] of Object.entries(previous)){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 }
});
