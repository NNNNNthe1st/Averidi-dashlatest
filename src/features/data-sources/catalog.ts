export const DASHBOARD_SOURCE_CATALOG = Object.freeze({
 FILE:{label:"File upload",availability:"AVAILABLE",credentialMode:"NONE"},
 GOOGLE_SHEETS:{label:"Google Sheets",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
 SHOPIFY:{label:"Shopify",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
 STRIPE:{label:"Stripe",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
 QUICKBOOKS:{label:"QuickBooks",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
 WOOCOMMERCE:{label:"WooCommerce",availability:"IMPLEMENTED",credentialMode:"API"},
 HUBSPOT:{label:"HubSpot",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
 SQUARE:{label:"Square",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
 XERO:{label:"Xero",availability:"IMPLEMENTED",credentialMode:"OAUTH"},
} as const);
export type DashboardSourceKind=keyof typeof DASHBOARD_SOURCE_CATALOG;
export type DashboardSourceHealth="CONNECTED"|"SYNCING"|"EXPIRED"|"DELAYED"|"FAILED"|"DISCONNECTED";
const HEALTH=new Set<DashboardSourceHealth>(["CONNECTED","SYNCING","EXPIRED","DELAYED","FAILED","DISCONNECTED"]);
export function dashboardSourceHealth(value:unknown):DashboardSourceHealth{
 return typeof value==="string"&&HEALTH.has(value as DashboardSourceHealth)?value as DashboardSourceHealth:"FAILED";
}
export function dashboardSourceCapability(kind:string){
 const source=DASHBOARD_SOURCE_CATALOG[kind as DashboardSourceKind];
 return source?{kind,...source}:{kind:"UNKNOWN",label:"Unsupported source",availability:"IMPLEMENTED",credentialMode:"NONE"};
}
export function assertDashboardSourceAvailable(kind:string){
 if(kind!=="FILE"&&(!Object.prototype.hasOwnProperty.call(DASHBOARD_SOURCE_CATALOG,kind)||process.env.DASHBOARD_DATA_CONNECTORS_ENABLED!=="true"))throw new Error("CONNECTOR_NOT_ENABLED");
}
