import {NextResponse} from "next/server";
import {authorizeDashboardAdmin,dashboardAdminOverview} from "../../../../../server/admin-access";
export async function GET(request:Request){
 const actor=await authorizeDashboardAdmin(request,"dashboard:read");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 return NextResponse.json({overview:await dashboardAdminOverview()},{headers:{"Cache-Control":"private, no-store"}});
}
