import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../server/auth-boundary';
import {completeMarketingAuthorization,marketingRedirect} from '../../../../features/custom-sources/marketing-oauth';
import {customSourceHeaders,customSourceHttpError} from '../../../../features/custom-sources/http';
export async function GET(request:Request){try{const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('UNAUTHORIZED');const result=await completeMarketingAuthorization(actor,new URL(request.url).searchParams);return NextResponse.redirect(new URL('/dashboard/app/workspaces/'+encodeURIComponent(result.workspaceId)+'/custom-sources',marketingRedirect()),{headers:customSourceHeaders});}catch(e){return customSourceHttpError(e);}}
