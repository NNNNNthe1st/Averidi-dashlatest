import {quotaHttpError} from '../../../../features/quotas/http';
import { dashboardSameOrigin } from "../../../../server/request-origin";
import {NextResponse} from "next/server";
import {getAuthenticatedDashboardActor} from "../../../../server/auth-boundary";
import {acceptWorkspaceInvitation} from "../../../../features/workspaces/invitations";
export async function POST(request:Request){
 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
 const token=input&&typeof input==="object"&&"token" in input?(input as {token:unknown}).token:null;
 try {const result=await acceptWorkspaceInvitation(actor,token);
 return NextResponse.json(result,{status:result.ok?200:400,headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const quota=quotaHttpError(error);if(quota)return quota;throw error;}
}
