import {createHash,randomBytes,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {dashboardDb} from './db';
import {dashboardPublicOrigin} from './request-origin';
const scrypt=promisify(scryptCb);
export const normalizeEmail=(v:unknown)=>typeof v==='string'?v.trim().toLowerCase():'';
export const validEmail=(v:string)=>v.length>=5&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const validPassword=(v:unknown):v is string=>typeof v==='string'&&v.length>=12&&v.length<=128;
export async function hashPassword(p:string){const salt=randomBytes(16);const key=await scrypt(p,salt,64) as Buffer;return 'scrypt$'+salt.toString('hex')+'$'+key.toString('hex');}
export async function verifyPassword(p:string,stored:string){const parts=stored.split('$');if(parts.length!==3||parts[0]!=='scrypt'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;const actual=await scrypt(p,Buffer.from(parts[1],'hex'),64) as Buffer;return timingSafeEqual(actual,Buffer.from(parts[2],'hex'));}
export const tokenHash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const newToken=()=>randomBytes(32).toString('hex');
export async function rateLimit(request:Request,action:string,identifier:string,max=8){
 const ip=(request.headers.get('x-real-ip')??request.headers.get('x-forwarded-for')?.split(',')[0]??'unknown').slice(0,120);
 const key=tokenHash('local:'+action+':'+ip+':'+identifier),now=new Date(),until=new Date(Date.now()+900000);
 return dashboardDb.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;const row=await tx.dashboardRequestBucket.findUnique({where:{key}});if(!row||row.expiresAt<now){await tx.dashboardRequestBucket.upsert({where:{key},create:{key,count:1,windowStart:now,expiresAt:until},update:{count:1,windowStart:now,expiresAt:until}});return true;}if(row.count>=max)return false;await tx.dashboardRequestBucket.update({where:{key},data:{count:{increment:1}}});return true;});
}
/** Development only: without an email provider, print account links to the server terminal instead of emailing them. */
// Only honoured against the isolated development database, so it can never apply to a deployed environment.
export const developmentEmailConsole=()=>process.env.DASHBOARD_DEVELOPMENT_EMAIL_CONSOLE==='true'&&/\/dashboard_dev\?/.test(process.env.DASHBOARD_DATABASE_URL??'');
export const credentialEmailConfigured=()=>developmentEmailConsole()||Boolean(process.env.DASHBOARD_EMAIL_API_KEY&&process.env.DASHBOARD_EMAIL_FROM&&process.env.DASHBOARD_PUBLIC_URL);
export async function sendCredentialEmail(request:Request,to:string,kind:'verify'|'reset',token:string){
 if(developmentEmailConsole()){const url=new URL('/dashboard/app/'+(kind==='verify'?'verify':'reset-password'),dashboardPublicOrigin(request));url.searchParams.set('token',token);console.log(`\n[Averidi development] ${kind==='verify'?'Verify account':'Reset password'} for ${to}:\n${url.toString()}\n`);return;}
 const apiKey=process.env.DASHBOARD_EMAIL_API_KEY?.trim(),from=process.env.DASHBOARD_EMAIL_FROM?.trim();
 const publicUrl=process.env.DASHBOARD_PUBLIC_URL?.trim();
 if(!apiKey||!from||!publicUrl)throw Error('EMAIL_NOT_CONFIGURED');
 let canonical:URL;
 try{canonical=new URL(publicUrl);}catch{throw Error('EMAIL_URL_INVALID');}
 if(canonical.protocol!=='https:'||canonical.username||canonical.password||canonical.search||canonical.hash||canonical.pathname!=='/')throw Error('EMAIL_URL_INVALID');
 if(!/^([^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from))throw Error('EMAIL_FROM_INVALID');
 const origin=dashboardPublicOrigin(request);
 if(canonical.origin!==origin)throw Error('EMAIL_ORIGIN_MISMATCH');
 const url=new URL('/dashboard/app/'+(kind==='verify'?'verify':'reset-password'),origin);url.searchParams.set('token',token);
 const subject=kind==='verify'?'Verify your Averidi Dashboard account':'Reset your Averidi Dashboard password';
 const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,text:subject+'\n\n'+url.toString()}),signal:AbortSignal.timeout(10000)});
 if(!result.ok)throw Error('EMAIL_DELIVERY_FAILED');
}
