import {NextResponse} from "next/server";
import {authorizeDashboardAdmin} from "../../../../../server/admin-access";
import {dashboardDb} from "../../../../../server/db";
import {readAdminPage,adminPageResult} from "../../../../../server/admin-pagination";
export async function GET(request:Request){
 const actor=await authorizeDashboardAdmin(request,"dashboard:read");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 const page=readAdminPage(request);
 if(!page)return NextResponse.json({error:"INVALID_PAGINATION"},{status:400,headers:{"Cache-Control":"no-store"}});
 const workspaces=await dashboardDb.dashboardWorkspace.findMany({
  select:{id:true,name:true,createdAt:true,_count:{select:{memberships:true,datasets:true,views:true}}},
  orderBy:[{createdAt:"desc"},{id:"desc"}],take:page.take,cursor:page.cursor,skip:page.skip
 });
 return NextResponse.json(adminPageResult(workspaces,page.limit),{headers:{"Cache-Control":"private, no-store"}});
}
