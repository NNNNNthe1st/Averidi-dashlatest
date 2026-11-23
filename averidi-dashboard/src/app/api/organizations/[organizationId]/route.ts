import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {analysisJson} from '../../../../features/analysis/http';
import {headers,accountError} from '../../../../features/organizations/http';
import {readOrganization,mutateOrganization} from '../../../../features/organizations/service';
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{return NextResponse.json(await readOrganization(actor,(await context.params).organizationId),{headers});}catch(error){return accountError(error);}}
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const input=await analysisJson(request);return NextResponse.json(await mutateOrganization(actor,(await context.params).organizationId,input),{headers});}catch(error){return accountError(error);}}
