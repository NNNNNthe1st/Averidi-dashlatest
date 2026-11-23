import {randomUUID} from 'node:crypto';
import * as storageModule from '../src/server/storage.ts';
import * as objectModule from '../src/server/object-storage.ts';
import * as inventoryModule from '../src/features/storage/inventory.ts';
const {dashboardWorkspaceArtifactKey}=storageModule.default??storageModule;
const {dashboardObjectConfig,signedDashboardObjectRequest}=objectModule.default??objectModule;
const {dashboardStorageBackend}=inventoryModule.default??inventoryModule;
if(process.env.DASHBOARD_STORAGE_BACKEND!=='object'||process.env.DASHBOARD_STORAGE_WRITE_CHECK!=='true')throw Error('Use only an explicitly configured dedicated test bucket with DASHBOARD_STORAGE_WRITE_CHECK=true.');
const workspace='storage_probe_'+randomUUID(),key=dashboardWorkspaceArtifactKey('temporary',workspace,randomUUID()),backend=dashboardStorageBackend(),bytes=Buffer.from('Dashboard isolated storage probe '+randomUUID());
let written=false;
try{
 await backend.write(key,bytes);written=true;
 if(!(await backend.read(key)).equals(bytes))throw Error('STORAGE_PROVIDER_READ_MISMATCH');
 let immutable=false;try{await backend.write(key,Buffer.from('overwrite'));}catch{immutable=true;}if(!immutable)throw Error('STORAGE_PROVIDER_OVERWRITE_ALLOWED');
 const listed=(await backend.list(workspace)).find(object=>object.key===key);if(!listed)throw Error('STORAGE_PROVIDER_LIST_FAILED');
 const wrong=signedDashboardObjectRequest(dashboardObjectConfig(),key,'DELETE',undefined,new Date(),{ifMatch:'"nonmatching-dashboard-probe"'});
 const rejected=await fetch(wrong.url,{method:'DELETE',headers:wrong.headers,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(rejected.status!==412)throw Error('STORAGE_PROVIDER_CONDITIONAL_DELETE_REQUIRED');
 if(!(await backend.read(key)).equals(bytes))throw Error('STORAGE_PROVIDER_CHANGED');
 await backend.remove(listed);written=false;if(await backend.stat(key))throw Error('STORAGE_PROVIDER_DELETE_FAILED');
 console.log(JSON.stringify({verified:true,tls:true,immutableWrites:true,paginatedInventory:true,conditionalDeletes:true}));
}finally{if(written){const current=await backend.stat(key);if(current)await backend.remove(current);}}
