import path from 'node:path';
import {lstat,readFile} from 'node:fs/promises';

export function emailEnvironment(settings,origin){
 const allowed=['DASHBOARD_EMAIL_API_KEY','DASHBOARD_EMAIL_FROM','DASHBOARD_PUBLIC_URL'];
 if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(key=>!allowed.includes(key)))throw Error('Unexpected Dashboard email settings.');
 if(allowed.some(key=>typeof settings[key]!=='string'||!settings[key].trim()))throw Error('Dashboard email requires API key, sender and public URL.');
 const values=Object.fromEntries(allowed.map(key=>[key,settings[key].trim()]));
 if(!/^re_[A-Za-z0-9_-]+$/.test(values.DASHBOARD_EMAIL_API_KEY))throw Error('Invalid Resend API key format.');
 if(!/^([^<>\r\n]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(values.DASHBOARD_EMAIL_FROM)||/[\r\n]/.test(values.DASHBOARD_EMAIL_FROM))throw Error('Invalid Dashboard email sender.');
 let url;try{url=new URL(values.DASHBOARD_PUBLIC_URL);}catch{throw Error('Dashboard email requires an HTTPS origin.');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Dashboard email requires an HTTPS origin without a path.');
 if(origin&&url.origin!==origin)throw Error('Dashboard email URL must match this development mode origin. Rerun dev:email:configure.');
 return {...values,DASHBOARD_PUBLIC_URL:url.origin,DASHBOARD_PUBLIC_ORIGIN:url.origin};
}
export async function readDevelopmentEmail(root,origin){
 const filename=path.join(root,'.local/development/email.json');
 let info;try{info=await lstat(filename);}catch(error){if(error.code==='ENOENT')return {};throw error;}
 if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Dashboard email settings must be a private regular file (chmod 600).');
 let settings;try{settings=JSON.parse(await readFile(filename,'utf8'));}catch{throw Error('Invalid Dashboard email JSON.');}
 return emailEnvironment(settings,origin);
}
