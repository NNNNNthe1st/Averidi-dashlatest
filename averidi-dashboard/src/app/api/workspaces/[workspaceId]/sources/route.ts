import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from "next/server";
import {getAuthenticatedDashboardActor} from "../../../../../server/auth-boundary";
import {requireDashboardEntitlement} from "../../../../../features/subscriptions/entitlements";
import {listWorkspaceDataSources,dashboardSourceCatalogForCustomers} from "../../../../../features/data-sources/service";

type Ctx={params:Promise<{workspaceId:string}>};
const headers={"Cache-Control":"no-store"};
export async function GET(request:Request,context:Ctx){
 const permissionDenied=await enforceWorkspacePermission(request,context,'connectors.read');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
 const {workspaceId}=await context.params;
 if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers});
 const sources=await listWorkspaceDataSources(actor,workspaceId);
 if(!sources)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers});
 return NextResponse.json({sources,availableSourceKinds:dashboardSourceCatalogForCustomers()},{headers});
}
