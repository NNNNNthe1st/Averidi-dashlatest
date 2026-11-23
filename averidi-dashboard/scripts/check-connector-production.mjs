// Safe, read-only configuration preflight: never logs credentials or makes provider requests.
const providers=['GOOGLE_SHEETS','SHOPIFY','STRIPE','QUICKBOOKS','WOOCOMMERCE','HUBSPOT','SQUARE','XERO'];
const requested=(process.env.DASHBOARD_CONNECTOR_LAUNCH_PROVIDERS??'GOOGLE_SHEETS').split(',').map(x=>x.trim()).filter(Boolean);
const failures=[];
const requireValue=(name,valid)=>{if(!valid(process.env[name]??''))failures.push(name+' is missing or invalid');};
requireValue('DASHBOARD_PUBLIC_ORIGIN',value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;}catch{return false;}});
requireValue('DASHBOARD_CONNECTOR_ENCRYPTION_KEY',value=>/^[a-fA-F0-9]{64}$/.test(value));
if(process.env.DASHBOARD_DATA_CONNECTORS_ENABLED!=='true')failures.push('DASHBOARD_DATA_CONNECTORS_ENABLED is not true');
if(process.env.DASHBOARD_RELEASE_MODE==='OFF')failures.push('Dashboard release mode is OFF');
for(const provider of requested){
 if(!providers.includes(provider)){failures.push('Unsupported launch provider: '+provider);continue;}
 if(provider==='WOOCOMMERCE'){
  requireValue('DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS',value=>value.split(',').every(origin=>{try{const u=new URL(origin.trim());return u.protocol==='https:'&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}})&&!!value);
 }else{
  requireValue('DASHBOARD_CONNECTOR_'+provider+'_CLIENT_ID',value=>value.trim().length>0);
  requireValue('DASHBOARD_CONNECTOR_'+provider+'_CLIENT_SECRET',value=>value.trim().length>0);
 }
}
if(failures.length){for(const failure of failures)process.stderr.write('NOT READY: '+failure+'\n');process.exitCode=1;}
else process.stdout.write('Connector configuration preflight passed for '+requested.join(', ')+'. Provider authorization and live sync still require separate activation.\n');
