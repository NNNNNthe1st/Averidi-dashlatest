import {createHash} from 'node:crypto';
import {dashboardDb as db} from '../../server/db';
import {readDashboardObject,dashboardStorageKey} from '../../server/storage';
import {prepareDashboardFile} from '../../engines/ingestion/ingest';
export async function relationshipSource(workspaceId:string,datasetId:string,versionId?:string){
 const dataset=await db.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:'READY'},include:{activeVersion:true}}),version=dataset?.activeVersion;
 if(!dataset||!version||version.status!=='READY'||!version.profiledAt)throw Error('DATASET_UNAVAILABLE');
 if(versionId&&version.id!==versionId)throw Error('VERSION_CONFLICT');
 if(version.storageKey!==dashboardStorageKey(workspaceId,datasetId,version.id))throw Error('SOURCE_INTEGRITY_FAILURE');
 if(!['CSV','JSON','XLSX'].includes(version.sourceFormat))throw Error('SOURCE_FORMAT_UNAVAILABLE');
 const bytes=await readDashboardObject(version.storageKey);
 if(BigInt(bytes.length)!==version.fileSize||createHash('sha256').update(bytes).digest('hex')!==version.checksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 const prepared=await prepareDashboardFile({bytes,fileName:'source.'+version.sourceFormat.toLowerCase(),worksheetName:version.sourceWorksheetName??undefined,preserveAllText:true});
 return {dataset,version,prepared};
}
