import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../server/db';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {normalizeEmail,validEmail,validPassword,rateLimit,newToken,tokenHash,sendCredentialEmail,hashPassword} from '../../../../server/local-credentials';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403,headers});
 const body=await request.json().catch(()=>null);
 if(body?.action==='request'){
  const email=normalizeEmail(body.email);
  if(!validEmail(email))return NextResponse.json({error:'INVALID_INPUT'},{status:400,headers});
  if(!await rateLimit(request,'reset',email,5))return NextResponse.json({error:'RATE_LIMITED'},{status:429,headers});
  const user=await dashboardDb.dashboardUser.findUnique({where:{email},select:{id:true,passwordHash:true}});
  if(user?.passwordHash){const token=newToken();await dashboardDb.dashboardCredentialToken.create({data:{userId:user.id,kind:'RESET',tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+1800000)}});try{await sendCredentialEmail(request,email,'reset',token);}catch{return NextResponse.json({error:'EMAIL_UNAVAILABLE'},{status:503,headers});}}
  return NextResponse.json({ok:true},{headers});
 }
 if(body?.action==='confirm'){
  const token=body.token,password=body.password;
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!validPassword(password))return NextResponse.json({error:'INVALID_INPUT'},{status:400,headers});
  const hashed=await hashPassword(password);
  const ok=await dashboardDb.$transaction(async tx=>{
   const record=await tx.dashboardCredentialToken.findUnique({where:{tokenHash:tokenHash(token)}});
   if(!record||record.kind!=='RESET'||record.consumedAt||record.expiresAt<=new Date())return false;
   const claimed=await tx.dashboardCredentialToken.updateMany({where:{id:record.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
   if(!claimed.count)return false;
   await tx.dashboardUser.update({where:{id:record.userId},data:{passwordHash:hashed}});
   await tx.dashboardSession.updateMany({where:{userId:record.userId,revokedAt:null},data:{revokedAt:new Date()}});
   await tx.dashboardCredentialToken.updateMany({where:{userId:record.userId,kind:'RESET',consumedAt:null},data:{consumedAt:new Date()}});
   return true;
  });
  return NextResponse.json(ok?{ok:true}:{error:'INVALID_OR_EXPIRED_TOKEN'},{status:ok?200:400,headers});
 }
 return NextResponse.json({error:'INVALID_ACTION'},{status:400,headers});
}