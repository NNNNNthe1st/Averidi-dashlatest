import {mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {randomBytes} from 'node:crypto';
const folder='.local/identity';
await mkdir(folder,{recursive:true,mode:0o700});
const compose=['compose','-f','infrastructure/development/identity/compose.yaml'];
let copied=false;
for(let attempt=0;attempt<30;attempt++){
 const result=spawnSync('docker',[...compose,'cp','dashboard-development-tls:/data/caddy/pki/authorities/local/root.crt',folder+'/root.crt'],{encoding:'utf8'});
 if(result.error)throw result.error;
 if(result.status===0){copied=true;break;}
 await delay(1000);
}
if(!copied)throw new Error('The Dashboard development TLS certificate is unavailable. Check the identity containers and run configure again.');
// Keep generated settings separate; never overwrite a developer's .env.local.
const filename=folder+'/dashboard.env';
let secret;
try {const previous=await readFile(filename,'utf8');secret=/^DASHBOARD_SESSION_SECRET=(.+)$/m.exec(previous)?.[1];}catch(error){if(error.code!=='ENOENT')throw error;}
secret??=randomBytes(48).toString('base64url');
await writeFile(filename,`DASHBOARD_PUBLIC_ORIGIN=https://localhost:8443
DASHBOARD_OIDC_ISSUER=https://localhost:9443/realms/dashboard-development
DASHBOARD_OIDC_AUDIENCE=averidi-dashboard-development
DASHBOARD_OIDC_CLIENT_ID=averidi-dashboard-development
DASHBOARD_OIDC_JWKS_URL=https://localhost:9443/realms/dashboard-development/protocol/openid-connect/certs
DASHBOARD_OIDC_AUTHORIZATION_URL=https://localhost:9443/realms/dashboard-development/protocol/openid-connect/auth
DASHBOARD_OIDC_TOKEN_URL=https://localhost:9443/realms/dashboard-development/protocol/openid-connect/token
DASHBOARD_OIDC_REDIRECT_URL=https://localhost:8443/dashboard/app/api/auth/callback
DASHBOARD_SESSION_SECRET=${secret}
`,{mode:0o600});
await chmod(filename,0o600);
console.log('Dashboard-only identity configuration created in .local/identity/dashboard.env. No secrets printed.');
