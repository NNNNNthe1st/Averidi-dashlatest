import {EXTERNAL_AVERIDI_INTEGRATION_ENABLED} from '../../contracts/integration';
import {validateDashboardOidcConfig,type DashboardOidcConfig} from '../../server/oidc-config';
/** Both a reviewed source-level unlock and explicit environment activation would be required. */
export function averidiIntegrationsActive(){return EXTERNAL_AVERIDI_INTEGRATION_ENABLED&&process.env.DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED==='true';}
export function ecosystemIdentityConfig(env:Partial<NodeJS.ProcessEnv>=process.env):DashboardOidcConfig{
 const issuer=env.DASHBOARD_ECOSYSTEM_OIDC_ISSUER??'',audience=env.DASHBOARD_ECOSYSTEM_OIDC_AUDIENCE??'',jwksUrl=env.DASHBOARD_ECOSYSTEM_OIDC_JWKS_URL??'';
 if(!issuer||!audience||!jwksUrl)throw Error('INTEGRATION_NOT_CONFIGURED');
 return validateDashboardOidcConfig({issuer,audience,jwksUrl});
}
