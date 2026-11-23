import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authorizeDashboardAdmin} from '../../../../../server/admin-access';
import {dashboardDb} from '../../../../../server/db';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
import {diagnosticJobError} from '../../../../../features/administration/diagnostics';
const filters=z.object({workspaceId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),status:z.enum(['QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED']).optional()}).strict();
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const actor=await authorizeDashboardAdmin(request,'dashboard:read');if(!actor)return json({error:'FORBIDDEN'},403);
 const page=readAdminPage(request);if(!page)return json({error:'INVALID_PAGINATION'},400);
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>!['limit','cursor','workspaceId','status'].includes(key))||['workspaceId','status'].some(key=>query.getAll(key).length>1))return json({error:'INVALID_DIAGNOSTIC_FILTER'},400);
 const scope=filters.safeParse(Object.fromEntries([...query].filter(([key])=>['workspaceId','status'].includes(key))));if(!scope.success)return json({error:'INVALID_DIAGNOSTIC_FILTER'},400);
 try{const jobs=await dashboardDb.dashboardJob.findMany({where:scope.data,select:{id:true,workspaceId:true,kind:true,status:true,attempts:true,progress:true,lastError:true,createdAt:true,updatedAt:true,availableAt:true,finishedAt:true,cancelRequestedAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:page.take,cursor:page.cursor,skip:page.skip});
 return json(adminPageResult(jobs.map(({lastError,...job})=>({...job,errorCode:diagnosticJobError(lastError)})),page.limit));}
 catch{return json({error:'DIAGNOSTICS_UNAVAILABLE'},503);}
}
