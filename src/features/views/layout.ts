import {z} from 'zod';
export const placementSchema=z.object({widgetId:z.string().min(1).max(120),x:z.number().int().min(0).max(11),y:z.number().int().min(0).max(999),width:z.number().int().min(2).max(12),height:z.number().int().min(2).max(12)}).strict().refine(p=>p.x+p.width<=12,{message:'Widget extends beyond the grid.'});
export type WidgetPlacement=z.infer<typeof placementSchema>;
export const pageSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),name:z.string().trim().min(1).max(80),widgets:z.array(placementSchema).max(100)}).strict();
export const pagesSchema=z.array(pageSchema).min(1).max(12).superRefine((pages,ctx)=>{
 if(new Set(pages.map(p=>p.id)).size!==pages.length)ctx.addIssue({code:'custom',message:'Duplicate page.'});
 const widgets=pages.flatMap(p=>p.widgets);if(new Set(widgets.map(p=>p.widgetId)).size!==widgets.length)ctx.addIssue({code:'custom',message:'A widget belongs to one page.'});
 for(const page of pages)for(let i=0;i<page.widgets.length;i++)for(let j=i+1;j<page.widgets.length;j++)if(overlaps(page.widgets[i],page.widgets[j]))ctx.addIssue({code:'custom',message:'Widgets overlap.'});
});
export type DashboardLayoutPage=z.infer<typeof pageSchema>;
export function overlaps(a:WidgetPlacement,b:WidgetPlacement){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}
export function freePlacement(widgetId:string,kind:string,occupied:WidgetPlacement[],size?:Pick<WidgetPlacement,'width'|'height'>):WidgetPlacement{
 const width=size?.width??(kind==='KPI'?4:6),height=size?.height??(kind==='KPI'?3:5);
 for(let y=0;y<=999;y++)for(let x=0;x<=12-width;x++){const p={widgetId,x,y,width,height};if(!occupied.some(other=>overlaps(p,other)))return p;}
 throw Error('LAYOUT_FULL');
}
/** Fill newly added widgets without disturbing an existing page or position. */
export function normalizeLayout(pages:DashboardLayoutPage[],widgets:{id:string;kind:string;order:number}[]):DashboardLayoutPage[]{
 const ids=new Set(widgets.map(w=>w.id)),seen=new Set<string>();
 const result=(pages.length?pages:[{id:'overview',name:'Overview',widgets:[]}]).map(page=>({...page,widgets:page.widgets.filter(p=>{if(!ids.has(p.widgetId)||seen.has(p.widgetId))return false;seen.add(p.widgetId);return true;})}));
 for(const widget of [...widgets].sort((a,b)=>a.order-b.order))if(!seen.has(widget.id)){result[0].widgets.push(freePlacement(widget.id,widget.kind,result[0].widgets));seen.add(widget.id);}
 return result;
}
export function validateLayoutMembership(pages:DashboardLayoutPage[],widgetIds:string[]){const assigned=pages.flatMap(p=>p.widgets.map(w=>w.widgetId));return assigned.length===widgetIds.length&&new Set(assigned).size===assigned.length&&widgetIds.every(id=>assigned.includes(id));}
export function positionWidget(pages:DashboardLayoutPage[],pageId:string,placement:WidgetPlacement):DashboardLayoutPage[]{
 const page=pages.find(p=>p.id===pageId);if(!page||!page.widgets.some(w=>w.widgetId===placement.widgetId))throw Error('INVALID_LAYOUT');
 if(!placementSchema.safeParse(placement).success)throw Error('INVALID_LAYOUT');if(page.widgets.some(p=>p.widgetId!==placement.widgetId&&overlaps(p,placement)))throw Error('LAYOUT_OVERLAP');
 return pages.map(p=>p.id===pageId?{...p,widgets:p.widgets.map(w=>w.widgetId===placement.widgetId?placement:w)}:p);
}
export function transferWidget(pages:DashboardLayoutPage[],widgetId:string,targetId:string,kind:string){
 const source=pages.find(p=>p.widgets.some(w=>w.widgetId===widgetId)),target=pages.find(p=>p.id===targetId);if(!source||!target)throw Error('INVALID_LAYOUT');if(source.id===target.id)return pages;
 const placement=freePlacement(widgetId,kind,target.widgets,source.widgets.find(w=>w.widgetId===widgetId));return pages.map(p=>p.id===source.id?{...p,widgets:p.widgets.filter(w=>w.widgetId!==widgetId)}:p.id===targetId?{...p,widgets:[...p.widgets,placement]}:p);
}
