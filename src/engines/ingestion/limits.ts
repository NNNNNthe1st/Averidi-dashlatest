/** Shared application and Next.js proxy limits, including multipart framing. */
export const DASHBOARD_MULTIPART_OVERHEAD_BYTES=65536;
export function dashboardMaxFileBytes(){
 const raw=Number(process.env.DASHBOARD_MAX_FILE_MB||25);
 const mb=Number.isInteger(raw)&&raw>0&&raw<=250?raw:25;
 return mb*1024*1024;
}
export function dashboardMaxUploadBodyBytes(){return dashboardMaxFileBytes()+DASHBOARD_MULTIPART_OVERHEAD_BYTES;}

