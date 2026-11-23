import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../server/auth-boundary';
import {accountMutationAudit} from '../../../../features/audit/service';
import {headers,accountError} from '../../../../features/organizations/http';
export async function GET(request:Request){const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{return NextResponse.json(await accountMutationAudit(actor,request),{headers});}catch(e){return accountError(e);}}
