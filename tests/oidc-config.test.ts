import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDashboardOidcConfig } from "../src/server/oidc-config";

const valid = {issuer:"https://identity.example.com/",audience:"averidi-dashboard",jwksUrl:"https://identity.example.com/.well-known/jwks.json"};
test("standalone OIDC config accepts same-origin HTTPS issuer and JWKS",()=>{
 assert.deepEqual(validateDashboardOidcConfig(valid),valid);
});
test("standalone OIDC config rejects HTTP, invalid audience and cross-origin keys",()=>{
 assert.throws(()=>validateDashboardOidcConfig({...valid,issuer:"http://identity.example.com/"}));
 assert.throws(()=>validateDashboardOidcConfig({...valid,audience:" "}));
 assert.throws(()=>validateDashboardOidcConfig({...valid,jwksUrl:"https://other.example.com/jwks"}));
});
test("standalone OIDC config rejects credentials and fragments",()=>{
 assert.throws(()=>validateDashboardOidcConfig({...valid,jwksUrl:"https://user:pass@identity.example.com/jwks"}));
 assert.throws(()=>validateDashboardOidcConfig({...valid,issuer:"https://identity.example.com/#frag"}));
});
