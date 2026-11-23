import {ecosystemApi} from '../../../../../../../features/ecosystem/api';
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){return ecosystemApi(request,(await c.params).workspaceId,'subscription');}
