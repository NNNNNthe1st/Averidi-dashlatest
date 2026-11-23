import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../server/db';
import {connectorActor,connectorHttpError,connectorHeaders} from '../../../../features/connectors/http-api';
import {completeConnectorAuthorization,connectorRedirectURL} from '../../../../features/connectors/service';
import {dashboardReleaseConfig,isDashboardWorkspaceReleased} from '../../../../server/release-gate';
/** One registered redirect URI for all connections; state resolves only the signed-in actor's attempt. */
export async function GET(request:Request){
 try{
  const actor=await connectorActor(request),params=new URL(request.url).searchParams,state=params.get('state')??'';
  if(params.getAll('state').length!==1||!/^[A-Za-z0-9_-]{43}$/.test(state))throw Error('CONNECTOR_OAUTH_REJECTED');
  const attempt=await dashboardDb.dashboardConnectorOAuthAttempt.findFirst({where:{id:createHash('sha256').update(state).digest('hex'),userId:actor.userId,consumedAt:null,expiresAt:{gt:new Date()}}});
  if(!attempt)throw Error('CONNECTOR_OAUTH_REJECTED');
  if(!isDashboardWorkspaceReleased(attempt.workspaceId,dashboardReleaseConfig()))throw Error('FORBIDDEN');
  await completeConnectorAuthorization(actor,attempt.workspaceId,attempt.connectorId,params);
  return NextResponse.redirect(new URL(`/dashboard/app/workspaces/${encodeURIComponent(attempt.workspaceId)}/studio`,connectorRedirectURL()),{headers:connectorHeaders});
 }catch(error){return connectorHttpError(error);}
}
