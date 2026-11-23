/** Standalone account development. No identity provider or fixture is used. */
export function standaloneCodespacesOrigin(env=process.env){
 if(env.NODE_ENV==='production'||env.CODESPACES!=='true'||env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN!=='app.github.dev'||!/^[a-z0-9][a-z0-9-]{6,98}[a-z0-9]$/.test(env.CODESPACE_NAME??''))throw Error('This command requires a development GitHub Codespace.');
 return `https://${env.CODESPACE_NAME}-3000.app.github.dev`;
}
export function standaloneCodespacesSettings(env=process.env){
 const origin=standaloneCodespacesOrigin(env);
 return {NODE_ENV:'development',DASHBOARD_DEVELOPMENT_CODESPACES:'true',DASHBOARD_PUBLIC_ORIGIN:origin,DASHBOARD_PUBLIC_URL:origin,DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_BETA_WORKSPACE_IDS:''};
}
