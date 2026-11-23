// Saves a connection's OAuth client for development:
//   npm run averidi:google-sheets   or   npm run averidi:shopify
// Reads DASHBOARD_CONNECTOR_<PROVIDER>_CLIENT_ID / _SECRET (e.g. Codespaces secrets) or asks for them.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {privateDirectory,privateJson} from './development/environment.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const provider=process.argv[2]==='shopify'?'SHOPIFY':'GOOGLE_SHEETS';const title=provider==='SHOPIFY'?'Shopify':'Google';const file=provider==='SHOPIFY'?'shopify.json':'google-sheets.json';
try{
 let clientId=process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_ID`]?.trim(),clientSecret=process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_SECRET`]?.trim();
 if(!clientId||!clientSecret){
  const rl=createInterface({input:process.stdin,output:process.stdout});
  clientId||=(await rl.question(`${title} Client ID: `)).trim();
  clientSecret||=(await rl.question(`${title} Client Secret: `)).trim();
  rl.close();
 }
 if(provider==='GOOGLE_SHEETS'&&!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId??''))throw Error('That does not look like a Google OAuth Client ID (it ends with .apps.googleusercontent.com).');
 if(provider==='SHOPIFY'&&!/^[A-Za-z0-9]{16,64}$/.test(clientId??''))throw Error('That does not look like a Shopify Client ID (letters and numbers, from the app Settings page).');
 if(!clientSecret||clientSecret.length<10||/\s/.test(clientSecret))throw Error('The Client Secret looks invalid.');
 const folder=path.join(root,'.local/development');await privateDirectory(folder);
 await privateJson(path.join(folder,file),{clientId,clientSecret});
 console.log(`${title} connection saved privately in .local/development/${file}. Restart: npm run averidi:start`);
}catch(error){console.error(error.message);process.exitCode=1;}
