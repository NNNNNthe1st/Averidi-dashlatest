/** Cookie-authenticated mutations must originate from this Dashboard application. */
export function dashboardPublicOrigin(request:Request):string {
 const configured=process.env.DASHBOARD_PUBLIC_ORIGIN;
 if(!configured)return new URL(request.url).origin;
 const url=new URL(configured);
 if(url.protocol!=="https:"||url.username||url.password)throw new Error("Invalid Dashboard public origin.");
 return url.origin;
}
export function dashboardSameOrigin(request:Request){
 const expected=dashboardPublicOrigin(request),actual=request.headers.get('origin');
 const crossSite=request.headers.get('sec-fetch-site')==='cross-site';
 const allowed=!crossSite&&(actual===expected||codespacesForwardedOrigin(request,expected,actual));
 if(!allowed&&process.env.NODE_ENV!=='production'){
  // Origins only; never log bodies, cookies, query strings or tokens.
  const safeOrigin=(value:string|null)=>{try{const url=new URL(value??'');return ['https:','http:'].includes(url.protocol)?url.origin:'invalid';}catch{return value===null?'missing':'invalid';}};
  console.error(JSON.stringify({event:'dashboard_origin_rejected',reason:actual!==expected?'ORIGIN_MISMATCH':'CROSS_SITE_REQUEST',expectedOrigin:safeOrigin(expected),requestOrigin:safeOrigin(actual)}));
 }
 return allowed;
}

/** Codespaces forwarding rewrites Origin to loopback but preserves Referer.
 * Restrict this compatibility path to the launcher-owned development mode. */
function codespacesForwardedOrigin(request:Request,expected:string,actual:string|null):boolean {
 const env=process.env;
 if(env.NODE_ENV!=='development'||env.CODESPACES!=='true'||env.DASHBOARD_DEVELOPMENT_CODESPACES!=='true'||
    env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN!=='app.github.dev'||
    !/^[a-z0-9][a-z0-9-]{6,98}[a-z0-9]$/.test(env.CODESPACE_NAME??''))return false;
 const publicOrigin=`https://${env.CODESPACE_NAME}-3000.app.github.dev`;
 if(expected!==publicOrigin||!['http://localhost:3000','https://localhost:3000'].includes(actual??'')||
    request.headers.get('sec-fetch-site')!=='same-origin')return false;
 try {
  const referer=new URL(request.headers.get('referer')??'');
  return !referer.username&&!referer.password&&referer.origin===publicOrigin;
 }catch{return false;}
}
