import {NextResponse} from "next/server";
import {authorizeDashboardAdmin} from "../../../../../server/admin-access";
import {dashboardDb} from "../../../../../server/db";
import {readAdminPage,adminPageResult} from "../../../../../server/admin-pagination";
export async function GET(request:Request){
 const actor=await authorizeDashboardAdmin(request,"dashboard:read");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 const url=new URL(request.url),workspaceId=url.searchParams.get("workspaceId");
 if(workspaceId&&!/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId))return NextResponse.json({error:"INVALID_WORKSPACE"},{status:400,headers:{"Cache-Control":"no-store"}});
 const page=readAdminPage(request);if(!page)return NextResponse.json({error:"INVALID_PAGINATION"},{status:400,headers:{"Cache-Control":"no-store"}});
 const logs=await dashboardDb.dashboardAdminAudit.findMany({where:workspaceId?{workspaceId}:{},orderBy:[{createdAt:"desc"},{id:"desc"}],take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,actorIssuer:true,actorSubject:true,action:true,workspaceId:true,createdAt:true}});
 return NextResponse.json(adminPageResult(logs,page.limit),{headers:{"Cache-Control":"private, no-store"}});
}
