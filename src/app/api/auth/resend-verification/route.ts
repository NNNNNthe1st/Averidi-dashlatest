import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../server/db';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {normalizeEmail,validEmail,rateLimit,newToken,tokenHash,sendCredentialEmail} from '../../../../server/local-credentials';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403,headers});
 const body=await request.json().catch(()=>null),email=normalizeEmail(body?.email);
 if(!validEmail(email))return NextResponse.json({error:'INVALID_INPUT'},{status:400,headers});
 if(!await rateLimit(request,'verify-email',email,4))return NextResponse.json({error:'RATE_LIMITED'},{status:429,headers});
 const response=()=>NextResponse.json({ok:true,message:'If verification is needed, a new link will be emailed.'},{headers});
 const user=await dashboardDb.dashboardUser.findUnique({where:{email},select:{id:true,emailVerifiedAt:true,passwordHash:true}});
 if(!user?.passwordHash||user.emailVerifiedAt)return response();
 const token=newToken();
 await dashboardDb.dashboardCredentialToken.create({data:{userId:user.id,kind:'VERIFY',tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+86400000)}});
 try{await sendCredentialEmail(request,email,'verify',token);}catch{return NextResponse.json({error:'EMAIL_UNAVAILABLE'},{status:503,headers});}
 return response();
}