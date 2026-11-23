import {setAuditActor} from '../audit/context';
import {authorizedView} from '../sharing/access';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {requireAnalysisAccess} from '../analysis/service';
import {definitionSchema} from './validation';
import {pagesSchema,normalizeLayout,validateLayoutMembership} from './layout';
export async function readDashboardLayout(actor:Actor,workspaceId:string,viewId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 return db.$transaction(async tx=>{
  const view=await authorizedView(actor,workspaceId,viewId,'VIEW',tx);if(!view)throw Error('NOT_FOUND');
  const definition=definitionSchema.safeParse(view.definition);if(!definition.success)throw Error('INVALID_VIEW');
  const records=await tx.dashboardPage.findMany({where:{viewId,workspaceId},orderBy:{position:'asc'}});
  const saved=records.map(record=>{const layout=record.layout as {key?:unknown;widgets?:unknown};return {id:typeof layout?.key==='string'?layout.key:record.id,name:record.name,widgets:layout?.widgets??[]};});
  const parsed=pagesSchema.safeParse(saved),pages=normalizeLayout(parsed.success?parsed.data:[],definition.data.widgets);
  return {pages,customized:records.length>0&&parsed.success&&records.some(p=>Array.isArray((p.layout as {widgets?:unknown})?.widgets)),updatedAt:view.updatedAt.toISOString()};
 },{isolationLevel:'RepeatableRead'});
}
export async function saveDashboardLayout(actor:Actor,workspaceId:string,viewId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 const parsed=z.object({pages:pagesSchema,expectedUpdatedAt:z.iso.datetime()}).strict().safeParse(input);if(!parsed.success)throw Error('INVALID_LAYOUT');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardView" WHERE id=${viewId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const view=await authorizedView(actor,workspaceId,viewId,'EDIT',tx);if(!view)throw Error('NOT_FOUND');if(view.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt)throw Error('VERSION_CONFLICT');
  const definition=definitionSchema.safeParse(view.definition);if(!definition.success||!validateLayoutMembership(parsed.data.pages,definition.data.widgets.map(w=>w.id)))throw Error('INVALID_LAYOUT');
  // Page records store presentation only. Metric definitions and source lineage are untouched.
  await tx.dashboardPage.deleteMany({where:{viewId,workspaceId}});
  await tx.dashboardPage.createMany({data:parsed.data.pages.map((page,position)=>({id:viewId+':'+page.id,viewId,workspaceId,name:page.name,position,layout:{key:page.id,widgets:page.widgets} as Prisma.InputJsonValue}))});
  const updatedAt=new Date(Math.max(Date.now(),view.updatedAt.getTime()+1));await tx.dashboardView.update({where:{id:viewId},data:{updatedAt}});
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'DASHBOARD_LAYOUT_SAVED',resourceType:'VIEW',resourceId:viewId,details:{pages:parsed.data.pages.length}}});
  return {updatedAt:updatedAt.toISOString()};
 });
}
