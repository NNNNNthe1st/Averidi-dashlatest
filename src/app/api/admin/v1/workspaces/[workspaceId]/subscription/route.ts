import {NextResponse} from "next/server";
import {authorizeDashboardAdmin} from "../../../../../../../server/admin-access";
import {dashboardDb} from "../../../../../../../server/db";
import {applyDashboardSubscriptionChange} from "../../../../../../../features/subscriptions/lifecycle";
import {billingBody,billingError} from "../../../../../../../features/billing/http";
type C={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:C){
 const actor=await authorizeDashboardAdmin(request,"dashboard:read");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 const {workspaceId}=await context.params;
 const subscription=await dashboardDb.dashboardSubscription.findUnique({where:{workspaceId},select:{workspaceId:true,planCode:true,status:true,currentPeriodEnd:true,updatedAt:true,accessSuspended:true,billingPlan:{select:{code:true,name:true,active:true,entitlements:true}}}});
 return NextResponse.json({subscription},{headers:{"Cache-Control":"private, no-store"}});
}
export async function PUT(request:Request,context:C){
 const actor=await authorizeDashboardAdmin(request,"dashboard:manage");
 if(!actor)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 let body:unknown;try{body=await billingBody(request);}catch(e){return billingError(e);}
 const {workspaceId}=await context.params;
 try{const result=await applyDashboardSubscriptionChange(workspaceId,body,actor);
 return NextResponse.json(result,{status:result.ok?200:result.error==="NOT_FOUND"?404:result.error==="PROVIDER_MANAGED"?409:400,headers:{"Cache-Control":"no-store"}});
 }catch(e){return billingError(e);}
}
