import {dashboardDb} from "./db";
export async function recordDashboardAdminAction(input:{issuer:string;subject:string;action:string;workspaceId?:string;details?:string}){
 await dashboardDb.dashboardAdminAudit.create({data:{
  actorIssuer:input.issuer,actorSubject:input.subject,action:input.action,
  workspaceId:input.workspaceId??null,details:input.details??null
 }});
}
