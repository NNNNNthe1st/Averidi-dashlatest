import {oidcLoopbackTarget,codespacesOidcSettings} from './codespaces.mjs';
if(process.env.DASHBOARD_DEVELOPMENT_CODESPACES_OIDC==='true'){
 const expected=codespacesOidcSettings();
 if(process.env.DASHBOARD_OIDC_ISSUER!==expected.DASHBOARD_OIDC_ISSUER||!process.env.NODE_EXTRA_CA_CERTS)throw Error('Codespaces OIDC transport requires its exact issuer and local CA.');
 const original=globalThis.fetch;
 globalThis.fetch=(input,init)=>{
  const target=oidcLoopbackTarget(input instanceof Request?input.url:String(input));
  return original(target?(input instanceof Request?new Request(target,input):target):input,init);
 };
}
