export type DashboardAdminPermission="dashboard:read"|"dashboard:manage";
export function allowsDashboardAdminPermission(claim:unknown,required:DashboardAdminPermission):boolean {
 if(!Array.isArray(claim)||claim.length<1||!claim.every(x=>x==="dashboard:read"||x==="dashboard:manage"))return false;
 return claim.includes(required)||(required==="dashboard:read"&&claim.includes("dashboard:manage"));
}
