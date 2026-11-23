import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../server/auth-boundary";

export async function GET(request:Request) {
  const actor=await getAuthenticatedDashboardActor(request);
  return NextResponse.json(
    actor?{authenticated:true,userId:actor.userId}:{authenticated:false},
    {status:actor?200:401,headers:{"Cache-Control":"private, no-store"}}
  );
}
