import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../server/db';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {tokenHash} from '../../../../server/local-credentials';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403,headers});
 const body=await request.json().catch(()=>null),token=body?.token;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({error:'INVALID_TOKEN'},{status:400,headers});
 const ok=await dashboardDb.$transaction(async tx=>{
  const record=await tx.dashboardCredentialToken.findUnique({where:{tokenHash:tokenHash(token)}});
  if(!record||record.kind!=='VERIFY'||record.expiresAt<=new Date())return false;
   // Repeated browser effects or retries must not turn a successful verification into an error.
   if(record.consumedAt)return Boolean(await tx.dashboardUser.count({where:{id:record.userId,emailVerifiedAt:{not:null},erasureRequestedAt:null}}));
  const used=await tx.dashboardCredentialToken.updateMany({where:{id:record.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
  if(!used.count)return Boolean(await tx.dashboardUser.count({where:{id:record.userId,emailVerifiedAt:{not:null},erasureRequestedAt:null}}));
  await tx.dashboardUser.update({where:{id:record.userId},data:{emailVerifiedAt:new Date()}});
  return true;
 });
 return NextResponse.json(ok?{ok:true}:{error:'INVALID_OR_EXPIRED_TOKEN'},{status:ok?200:400,headers});
}