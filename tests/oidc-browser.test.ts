import {test} from "node:test";
import assert from "node:assert/strict";
import {beginDashboardLogin} from "../src/server/oidc-browser";

test("browser login fails closed without a verified identity-provider configuration",async()=>{
 const original={
  DASHBOARD_OIDC_ISSUER:process.env.DASHBOARD_OIDC_ISSUER,
  DASHBOARD_OIDC_JWKS_URL:process.env.DASHBOARD_OIDC_JWKS_URL,
  DASHBOARD_OIDC_CLIENT_ID:process.env.DASHBOARD_OIDC_CLIENT_ID,
  DASHBOARD_OIDC_AUTHORIZATION_URL:process.env.DASHBOARD_OIDC_AUTHORIZATION_URL,
  DASHBOARD_OIDC_TOKEN_URL:process.env.DASHBOARD_OIDC_TOKEN_URL,
  DASHBOARD_OIDC_REDIRECT_URL:process.env.DASHBOARD_OIDC_REDIRECT_URL,
 };
 try{
  delete process.env.DASHBOARD_OIDC_CLIENT_ID;
  await assert.rejects(()=>beginDashboardLogin(),/not configured/i);
 }finally{
  for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
