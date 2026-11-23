import {NextResponse} from "next/server";
import {checkDashboardReadiness} from "../../../../server/health-readiness";

export const dynamic="force-dynamic";
export async function GET(){
 try{
  const result=await checkDashboardReadiness();
  return NextResponse.json(result,{status:result.ready?200:503,headers:{"Cache-Control":"no-store"}});
 }catch{
  return NextResponse.json({product:"averidi-dashboard",ready:false},{status:503,headers:{"Cache-Control":"no-store"}});
 }
}
