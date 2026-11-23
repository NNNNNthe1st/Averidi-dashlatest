import sharp from 'sharp';
import {reportBrandingSchema,type ReportBranding} from './settings';
/** Decode bounded PNG pixels and re-encode metadata-free bytes. Never accept URLs or SVG markup. */
export async function normalizeReportBranding(input:unknown):Promise<ReportBranding>{
 const branding=reportBrandingSchema.parse(input);if(!branding.logoDataUrl)return branding;
 try{
  const bytes=Buffer.from(branding.logoDataUrl.split(',')[1],'base64');
  if(bytes.length>24576||bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error();
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>256||height>256)throw Error();
  const logo=await sharp(bytes,{limitInputPixels:65536,failOn:'warning'}).rotate().png({compressionLevel:9}).toBuffer();
  if(logo.length>24576)throw Error();return {...branding,logoDataUrl:'data:image/png;base64,'+logo.toString('base64')};
 }catch{throw Error('INVALID_REPORT_DEFINITION');}
}
