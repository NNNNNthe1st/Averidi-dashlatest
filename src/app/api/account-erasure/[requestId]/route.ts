import {NextResponse} from 'next/server';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {erasureReceipt,retryErasureReceipt} from '../../../../features/account-erasure/service';
import {erasureHeaders,erasureHttpError,receiptToken} from '../../../../features/account-erasure/http';
type Context={params:Promise<{requestId:string}>};
export async function GET(request:Request,context:Context){try{return NextResponse.json(await erasureReceipt((await context.params).requestId,receiptToken(request)),{headers:erasureHeaders});}catch(e){return erasureHttpError(e);}}
export async function POST(request:Request,context:Context){try{if(!dashboardSameOrigin(request))throw Error('FORBIDDEN');return NextResponse.json(await retryErasureReceipt((await context.params).requestId,receiptToken(request)),{status:202,headers:erasureHeaders});}catch(e){return erasureHttpError(e);}}
