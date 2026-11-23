import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {analysisJson} from '../../../../features/analysis/http';
import {headers,accountError} from '../../../../features/organizations/http';
import {acceptOrganizationInvitation} from '../../../../features/organizations/service';
export async function POST(request:Request){if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{return NextResponse.json(await acceptOrganizationInvitation(actor,await analysisJson(request)),{headers});}catch(error){return accountError(error);}}
