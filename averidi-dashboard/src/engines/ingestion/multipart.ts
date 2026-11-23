import {dashboardMaxUploadBodyBytes} from './limits';
export class DashboardUploadRequestError extends Error{
 constructor(public code:string,public status:number){super(code);this.name='DashboardUploadRequestError';}
}
/** Bound the actual bytes even when a proxy removes Content-Length or a client streams. */
export async function readDashboardMultipart(request:Request):Promise<FormData>{
 const contentType=request.headers.get('content-type')??'';
 if(!/^multipart\/form-data\s*;/i.test(contentType))throw new DashboardUploadRequestError('INVALID_CONTENT_TYPE',415);
 const declared=request.headers.get('content-length'),limit=dashboardMaxUploadBodyBytes();
 if(declared!==null&&(!/^[0-9]+$/.test(declared)||!Number.isSafeInteger(Number(declared))||Number(declared)<1))throw new DashboardUploadRequestError('INVALID_CONTENT_LENGTH',400);
 if(declared!==null&&Number(declared)>limit)throw new DashboardUploadRequestError('BODY_TOO_LARGE',413);
 if(!request.body)throw new DashboardUploadRequestError('FILE_REQUIRED',400);
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>limit){await reader.cancel().catch(()=>{});throw new DashboardUploadRequestError('BODY_TOO_LARGE',413);}
   chunks.push(value);
  }
 }catch(error){if(error instanceof DashboardUploadRequestError)throw error;throw new DashboardUploadRequestError('INVALID_MULTIPART',400);}
 finally{reader.releaseLock();}
 if(declared!==null&&total!==Number(declared))throw new DashboardUploadRequestError('INVALID_MULTIPART',400);
 const body=new Uint8Array(total);let position=0;for(const chunk of chunks){body.set(chunk,position);position+=chunk.byteLength;}
 try{return await new Response(body,{headers:{'content-type':contentType}}).formData();}
 catch{throw new DashboardUploadRequestError('INVALID_MULTIPART',400);}
}

