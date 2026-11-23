import {setAuditActor} from '../../../../../../features/audit/context';
import {NextResponse} from "next/server";
import {workspaceRenameSchema as renameSchema} from "../../../../../../contracts/administration";
import {authorizeDashboardAdmin} from "../../../../../../server/admin-access";
import {dashboardDb} from "../../../../../../server/db";
import {analysisJson} from "../../../../../../features/analysis/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const actor=await authorizeDashboardAdmin(request,"dashboard:read");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 const {workspaceId}=await context.params;
 const workspace=await dashboardDb.dashboardWorkspace.findUnique({where:{id:workspaceId},select:{id:true,name:true,createdAt:true,_count:{select:{memberships:true,datasets:true,views:true}}}});
 return workspace?NextResponse.json({workspace},{headers:{"Cache-Control":"private, no-store"}}):NextResponse.json({error:"NOT_FOUND"},{status:404,headers:{"Cache-Control":"no-store"}});
}
export async function PATCH(request:Request,context:Context){
 const actor=await authorizeDashboardAdmin(request,"dashboard:manage");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 let body:unknown;try{body=await analysisJson(request);}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400,headers:{"Cache-Control":"no-store"}});}
 const parsed=renameSchema.safeParse(body);
 if(!parsed.success)return NextResponse.json({error:"INVALID_WORKSPACE"},{status:400,headers:{"Cache-Control":"no-store"}});
 const {workspaceId}=await context.params;
 const result=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor);
  const found=await tx.dashboardWorkspace.findUnique({where:{id:workspaceId},select:{id:true,name:true}});
  if(!found)return null;
  await tx.dashboardWorkspace.update({where:{id:workspaceId},data:{name:parsed.data.name}});
  await tx.dashboardAdminAudit.create({data:{actorIssuer:actor.issuer,actorSubject:actor.subject,action:"ADMIN_WORKSPACE_RENAME",workspaceId,details:JSON.stringify({previous:found.name,next:parsed.data.name})}});
  return {id:workspaceId,name:parsed.data.name};
 });
 return result?NextResponse.json({workspace:result},{headers:{"Cache-Control":"no-store"}}):NextResponse.json({error:"NOT_FOUND"},{status:404,headers:{"Cache-Control":"no-store"}});
}
