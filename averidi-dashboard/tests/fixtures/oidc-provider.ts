import {createServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';

/** Protocol fixture only: no customer-facing authentication bypass is installed. */
export async function startOidcFixture(browser?:{redirectUrl:string;subject:string}){
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk={...await exportJWK(publicKey),kid:'dashboard-test',alg:'RS256',use:'sig'};
 const codes=new Map<string,{nonce:string;challenge:string;redirect:string;client:string}>();
 const logins=new Map<string,{nonce:string;challenge:string;redirect:string;client:string;state:string}>();
 let issuer='',mode:'valid'|'wrong-nonce'|'wrong-audience'|'wrong-issuer'|'expired'|'wrong-azp'|'wrong-signature'|'oversized'|'invalid-json'|'empty-subject'='valid';
 const server=createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},async(req,res)=>{
  try{
   const url=new URL(req.url!,issuer);
   res.setHeader('content-type','application/json');
   if(url.pathname==='/.well-known/openid-configuration'){res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],code_challenge_methods_supported:['S256']}));return;}
   if(url.pathname==='/jwks'){res.end(JSON.stringify({keys:[jwk]}));return;}
   if(url.pathname==='/authorize'){
    const data={nonce:url.searchParams.get('nonce')!,challenge:url.searchParams.get('code_challenge')!,redirect:url.searchParams.get('redirect_uri')!,client:url.searchParams.get('client_id')!,state:url.searchParams.get('state')!};
    if(data.client!=='dashboard-test-client'||url.searchParams.get('code_challenge_method')!=='S256'||!data.nonce||!data.state||!data.challenge||(browser&&data.redirect!==browser.redirectUrl)){res.statusCode=400;res.end('{}');return;}
    if(browser){
     const ticket=randomUUID();logins.set(ticket,data);res.setHeader('content-type','text/html');
     res.end(`<html lang="en"><title>Dashboard test identity</title><h1>Sign in to test identity</h1><form method="POST" action="/fixture-login"><input type="hidden" name="ticket" value="${ticket}"><label>Username <input name="username" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form></html>`);return;
    }
    const code=randomUUID();codes.set(code,data);res.end(JSON.stringify({code,state:data.state}));return;
   }
   if(url.pathname==='/fixture-login'&&browser&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    const form=new URLSearchParams(body),ticket=form.get('ticket')!,data=logins.get(ticket);
    logins.delete(ticket);
    if(!data||form.get('username')!=='dashboard-test-user'||form.get('password')!=='dashboard-test-password'){res.statusCode=401;res.end('{}');return;}
    const code=randomUUID();codes.set(code,data);const callback=new URL(data.redirect);callback.searchParams.set('state',data.state);callback.searchParams.set('code',code);res.writeHead(303,{location:callback.toString()});res.end();return;
   }
   if(url.pathname==='/token'){
    let body='';for await(const chunk of req)body+=chunk;
    const form=new URLSearchParams(body),code=form.get('code')!,data=codes.get(code);
    codes.delete(code);
    if(!data||form.get('client_id')!==data.client||form.get('redirect_uri')!==data.redirect||createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==data.challenge){res.statusCode=400;res.end('{}');return;}
    if(mode==='oversized'){res.end(JSON.stringify({id_token:'x'.repeat(70000)}));return;}
    if(mode==='invalid-json'){res.end('not JSON');return;}
    const jwt=await new SignJWT({nonce:mode==='wrong-nonce'?'bad':data.nonce,...(mode==='wrong-azp'?{azp:'other-client'}:{})})
     .setProtectedHeader({alg:'RS256',kid:'dashboard-test'}).setIssuer(mode==='wrong-issuer'?issuer+'/wrong':issuer)
     .setAudience(mode==='wrong-audience'?'other-client':'dashboard-test-client').setSubject(mode==='empty-subject'?' ':browser?.subject??'external-person')
     .setIssuedAt().setExpirationTime(mode==='expired'?Math.floor(Date.now()/1000)-90:'5m').sign(mode==='wrong-signature'?(await generateKeyPair('RS256')).privateKey:privateKey);
    res.end(JSON.stringify({id_token:jwt}));return;
   }
   res.statusCode=404;res.end('{}');
  }catch{res.statusCode=500;res.end('{}');}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test provider port');
 issuer=`https://127.0.0.1:${address.port}`;
 return {issuer,setMode:(value:typeof mode)=>{mode=value;},close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
