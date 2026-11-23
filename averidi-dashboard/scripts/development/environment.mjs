import path from 'node:path';
import {readFile,lstat,mkdir,chmod,writeFile} from 'node:fs/promises';

/** @param {Record<string,string|undefined>} [source] @returns {Record<string,string|undefined>} */
export function cleanDevelopmentEnvironment(source=process.env){
 const env=Object.fromEntries(Object.entries(source).filter(([key])=>!key.startsWith('DASHBOARD_')&&!['DATABASE_URL','COMPOSE_FILE','COMPOSE_PROJECT_NAME','NODE_EXTRA_CA_CERTS'].includes(key)));
 if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Development requires TLS certificate verification.');
 return {...env,CHECKPOINT_DISABLE:'1',NEXT_TELEMETRY_DISABLED:'1'};
}
export async function privateDirectory(folder){
 await mkdir(folder,{recursive:true,mode:0o700});
 const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Development directory must be a real private directory.');
 await chmod(folder,0o700);
}
export async function privateJson(filename,value,{create=false}={}){
 // A generated configuration is never permitted to follow a symlink.
 try{const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe development configuration file.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(filename,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:create?'wx':'w'});await chmod(filename,0o600);
}
const disabled={DASHBOARD_QUERY_CACHE_ENABLED:'false',DASHBOARD_ACCOUNT_ERASURE_ENABLED:'false',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_DATA_CONNECTORS_ENABLED:'false',DASHBOARD_BILLING_ENABLED:'false',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false'};
/** @param {{databaseUrl:string,sessionSecret:string,connectorKey:string}} settings
 * @param {string} root
 * @param {Record<string,string|undefined>} [source]
 * @returns {Record<string,string|undefined>} */
export function developmentRuntime(settings,root,source=process.env){
 const url=new URL(settings.databaseUrl);
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.pathname!=='/dashboard_dev'||decodeURIComponent(url.username)!=='dashboard_development_runtime'||!url.password||!url.port||url.hash||url.search!=='?schema=public')throw Error('Only the isolated development database/runtime role is allowed.');
 if(!/^[a-f0-9]{96}$/.test(settings.sessionSecret)||!/^[a-f0-9]{64}$/.test(settings.connectorKey))throw Error('Invalid development secrets.');
 return {...cleanDevelopmentEnvironment(source),...disabled,DASHBOARD_DATABASE_URL:url.toString(),DASHBOARD_MIGRATION_DATABASE_URL:'',DASHBOARD_OIDC_ISSUER:'',DASHBOARD_OIDC_AUDIENCE:'',DASHBOARD_OIDC_CLIENT_ID:'',DASHBOARD_OIDC_JWKS_URL:'',DASHBOARD_OIDC_AUTHORIZATION_URL:'',DASHBOARD_OIDC_TOKEN_URL:'',DASHBOARD_OIDC_REDIRECT_URL:'',DASHBOARD_STORAGE_ROOT:path.join(root,'.local/development/storage'),DASHBOARD_STORAGE_BACKEND:'local',DASHBOARD_SESSION_SECRET:settings.sessionSecret,DASHBOARD_CONNECTOR_ENCRYPTION_KEY:settings.connectorKey,DASHBOARD_SESSION_VERSION:'1',DASHBOARD_WORKER_ENABLED:'true',DASHBOARD_WORKER_POLL_MS:'1000',DASHBOARD_RELEASE_MODE:'OFF',DASHBOARD_BETA_WORKSPACE_IDS:'',DASHBOARD_PUBLIC_ORIGIN:'https://localhost:8443'};
}
export async function readDevelopmentSettings(root){
 const filename=path.join(root,'.local/development/runtime.json');const info=await lstat(filename);
 if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Development runtime configuration must be a private regular file.');
 const settings=JSON.parse(await readFile(filename,'utf8'));developmentRuntime(settings,root);return settings;
}

export function developmentOwner(value){
 let url;try{url=new URL(value);}catch{throw Error('A dedicated development owner URL is required.');}
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.pathname!=='/dashboard_dev'||decodeURIComponent(url.username)!=='dashboard'||!url.password||!url.port||url.hash||url.search!=='?schema=public')throw Error('Development provisioning requires the loopback dashboard_dev owner and public schema.');
 return url;
}
