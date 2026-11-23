import * as backupModule from '../src/features/storage/backup.ts';
import * as dbModule from '../src/server/db.ts';
const {createStorageBackup,restoreStorageBackup}=backupModule.default??backupModule;
const {dashboardDb}=dbModule.default??dbModule;
try{
 const [action,folder,...extra]=process.argv.slice(2);
 if(!['backup','restore'].includes(action)||!folder||extra.length>1||action==='restore'&&extra.length)throw Error('Usage: storage-backup.mjs backup|restore DIRECTORY [WORKSPACE_ID]');
 if(process.env.DASHBOARD_WORKER_ENABLED!=='false')throw Error('Stop the independent worker and set DASHBOARD_WORKER_ENABLED=false for backup/restore.');
 const secret=process.env.DASHBOARD_STORAGE_BACKUP_KEY??'';
 const result=action==='backup'?await createStorageBackup(folder,secret,extra[0]):await restoreStorageBackup(folder,secret);
 console.log(JSON.stringify({action,...result}));
}catch(error){console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'STORAGE_BACKUP_FAILED');process.exitCode=1;}finally{await dashboardDb.$disconnect();}
