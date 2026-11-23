import path from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import {renderAsync} from '@resvg/resvg-js';
import type {DashboardWidgetData} from '../visualization/widgets';
import {reportBrandingSchema,type ReportBranding} from '../../features/reports/settings';
import type {WorkspacePresentation} from '../../features/workspaces/presentation-contracts';
export type VisualReportInput={name:string;dashboardName:string;data:DashboardWidgetData;analysisId:string;versionId:string;sourceChecksum:string;generatedAt:Date;branding?:ReportBranding;presentation?:WorkspacePresentation|null;pages?:{name:string;widgetIds:string[]}[]};
const width=794,height=1123,margin=40,bottom=1065;
const xml=(value:unknown)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const svg=(body:string,h=height)=>`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
export function formatReportValue(value:number|null,metric:DashboardWidgetData['analysis']['outcomes'][number],locale='en-US'){
 if(value===null||!Number.isFinite(value))return 'Unavailable';
 const unit=metric.lineage.unit;
 return new Intl.NumberFormat(locale,metric.definition.format==='CURRENCY'&&metric.lineage.currency?{style:'currency',currency:metric.lineage.currency,maximumFractionDigits:4}:metric.definition.format==='PERCENT'?{style:'percent',maximumFractionDigits:4}:{maximumFractionDigits:6}).format(value)+(unit?(metric.definition.format==='CURRENCY'?' / '+unit:metric.definition.format==='COUNT'?' '+unit:''):'');
}
/** Both formats share a bounded layout containing controlled SVG only. Customer text is always escaped. */
export async function renderVisualReport(input:VisualReportInput,format:'PDF'|'PNG',signal?:AbortSignal){
 signal?.throwIfAborted();const brand=reportBrandingSchema.parse(input.branding??{}),font=path.join(process.cwd(),'public','report-fonts','DejaVuSans.ttf');
 const date=input.generatedAt;if(!Number.isFinite(date.getTime()))throw Error('INVALID_REPORT_DATE');
 const doc=new PDFDocument({autoFirstPage:false,compress:true,info:{Title:input.name,Author:brand.businessName||'Averidi',Creator:'Averidi Dashboard',Producer:'Averidi Dashboard',CreationDate:date,ModDate:date}});
 const chunks:Buffer[]=[];let size=0;
 const completed=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32*1024*1024)doc.destroy(Error('REPORT_OUTPUT_LIMIT'));else chunks.push(chunk);});doc.once('end',()=>resolve(Buffer.concat(chunks)));doc.once('error',reject);});
 // Attach a rejection handler immediately, including the PNG path, without hiding the final result.
 void completed.catch(()=>{});doc.registerFont('ReportFont',font);doc.font('ReportFont');
 let body='',y=0;const sheets:string[]=[];
 function rawText(text:string,x:number,at:number,size=12,color='#172333'){body+=`<text x="${x}" y="${at}" font-family="DejaVu Sans" font-size="${size}" fill="${color}">${xml(text)}</text>`;}
 function page(){if(body)sheets.push(body);if(sheets.length>=100)throw Error('REPORT_PAGE_LIMIT');body='';y=42;body+=`<rect x="${margin}" y="24" width="714" height="5" fill="${brand.accentColor}"/>`;if(brand.logoDataUrl)body+=`<image x="${margin}" y="36" width="80" height="44" preserveAspectRatio="xMinYMid meet" xlink:href="${brand.logoDataUrl}"/>`;const x=brand.logoDataUrl?134:margin;const name=brand.businessName||'Business report',available=(brand.showAveridi?550:754)-x;let fontSize=17;while(fontSize>10&&doc.fontSize(fontSize).widthOfString(name)>available)fontSize--;let line='',lineY=y+14;for(const letter of name){if(line&&doc.fontSize(fontSize).widthOfString(line+letter)>available){rawText(line,x,lineY,fontSize);line='';lineY+=fontSize+3;}line+=letter;}if(line)rawText(line,x,lineY,fontSize);if(brand.showAveridi)rawText('Averidi Dashboard',570,y+14,12);y=Math.max(100,lineY+24);}
 function room(amount:number){signal?.throwIfAborted();if(y+amount>bottom)page();}
 function text(value:unknown,size=12,color='#172333',indent=0){
  const paragraphs=String(value??'').replace(/[\r\n]+/g,' ').split(/\s+/),max=width-margin*2-indent;let line='';
  const flush=()=>{room(size+8);rawText(line,margin+indent,y+size,size,color);y+=size+7;line='';};
  for(const word of paragraphs){const proposed=line?line+' '+word:word;doc.fontSize(size);if(doc.widthOfString(proposed)<=max){line=proposed;continue;}if(line)flush();let piece='';for(const letter of word){if(piece&&doc.widthOfString(piece+letter)>max){line=piece;flush();piece='';}piece+=letter;}line=piece;}
  if(line)flush();
 }
 function chart(widget:DashboardWidgetData['widgets'][number]){
  const points=widget.series.filter(p=>p.value!==null&&Number.isFinite(p.value));if(!points.length||widget.kind==='TABLE')return;room(150);const top=y,plotWidth=714,plotHeight=100,max=Math.max(1,...points.map(p=>Math.abs(p.value!))),zero=top+55;
  body+=`<line x1="40" y1="${zero}" x2="754" y2="${zero}" stroke="#8895a7"/>`;
  if(widget.kind==='HORIZONTAL_BAR'){for(const [i,p] of points.entries()){const rowHeight=100/points.length,w=Math.abs(p.value!)/max*340;body+=`<rect x="${p.value!>=0?397:397-w}" y="${top+i*rowHeight}" width="${w}" height="${Math.max(.5,rowHeight-1)}" fill="${brand.accentColor}"/>`;}body+=`<line x1="397" y1="${top}" x2="397" y2="${top+100}" stroke="#8895a7"/>`;}
  else if(widget.kind==='LINE'){const coords=points.map((p,i)=>`${margin+(i/(Math.max(1,points.length-1)))*plotWidth},${zero-p.value!/max*45}`).join(' ');body+=`<polyline points="${coords}" fill="none" stroke="${brand.accentColor}" stroke-width="2"/>`;for(const [i,p] of points.entries())body+=`<circle cx="${margin+i/Math.max(1,points.length-1)*plotWidth}" cy="${zero-p.value!/max*45}" r="2" fill="${brand.accentColor}"/>`;}
  else for(const [i,p] of points.entries()){const slot=plotWidth/points.length,h=Math.abs(p.value!)/max*45;body+=`<rect x="${margin+i*slot+1}" y="${p.value!>=0?zero-h:zero}" width="${Math.max(.5,slot-2)}" height="${h}" fill="${brand.accentColor}"/>`;}
  y=top+plotHeight+15;text(widget.kind==='HORIZONTAL_BAR'?'Chart follows the exact group order below; positive values are right of zero and negative values left.':'Chart follows the exact group order below; positive values are above zero and negative values below.',10,'#46546a');y+=8;
 }
 try{
  page();text(input.name,24);text(input.dashboardName,14);if(brand.subtitle)text(brand.subtitle,12);text('Generated '+new Intl.DateTimeFormat(input.presentation?.locale??'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:input.presentation?.timezone??'UTC'}).format(date)+' ('+(input.presentation?.timezone??'UTC')+')',10,'#46546a');
  text('Source version: '+input.versionId,10);text('Analysis: '+input.analysisId,10);text('Source checksum: '+input.sourceChecksum,9);text('Filters: '+JSON.stringify(input.data.analysis.outcomes[0]?.lineage.filters??[]),10);
  const comparison=input.data.analysis.comparisonPeriods;if(comparison)text(`Current ${comparison.current.start} through ${comparison.current.end}; comparison ${comparison.previous.start} through ${comparison.previous.end}. ${comparison.partial?'Both periods are aligned to the explicitly observed elapsed period.':''}`,11);
  y+=12;
  const groups=input.pages?.length?input.pages:[{name:'Dashboard',widgetIds:input.data.widgets.map(w=>w.id)}];
  for(const group of groups){const widgets=group.widgetIds.flatMap(id=>input.data.widgets.find(w=>w.id===id)??[]);if(!widgets.length)continue;room(80);text(group.name,17);
   for(const w of widgets){room(110);y+=10;text(w.title,17);text(w.outcome.definition.label+' · '+w.outcome.status,10,'#46546a');if(w.kind==='KPI'){text(formatReportValue(w.outcome.value,w.outcome,input.presentation?.locale),24);if(w.outcome.value!==null)text('Exact numeric value: '+w.outcome.value,10);}
    if(w.outcome.reason)text(w.outcome.reason,11);chart(w);
    for(const p of w.series){text(`${p.missing?'Missing value (empty source cell)':p.label}: ${formatReportValue(p.value,w.outcome,input.presentation?.locale)}${p.value!==null?' (exact: '+p.value+')':''} · ${p.status}`,11);if(p.reason)text(p.reason,10,'#46546a',12);if(p.comparison)text(`Previous: ${p.comparison.previous??'Unavailable'}; absolute change: ${p.comparison.absolute??'Unavailable'}; relative change: ${p.comparison.percentage??'Unavailable'}`,10,'#46546a',12);}
    const c=input.data.analysis.comparison?.[w.metricKey];if(c&&w.kind==='KPI')text(`Previous: ${c.previous??'Unavailable'}; absolute change: ${c.absolute??'Unavailable'}; relative change: ${c.percentage??'Unavailable'}`,10);
    text('Definition: '+w.outcome.definition.formula,10,'#46546a');text('Source fields: '+w.outcome.lineage.fields.join(', ')+' · rows: '+w.outcome.lineage.rowCount,10,'#46546a');text('Processed: '+(w.outcome.lineage.refreshedAt??'Unavailable')+' · calculated: '+(w.outcome.lineage.calculatedAt??'Unavailable'),9,'#46546a');
   }
  }
  if(!input.data.widgets.length)text('No visible widgets in this dashboard.');if(body)sheets.push(body);
  const pages=sheets.map((part,i)=>svg(part+`<text x="40" y="1092" font-family="DejaVu Sans" font-size="10" fill="#46546a">${brand.showAveridi?'Averidi Dashboard · ':''}Page ${i+1} of ${sheets.length} · Governed source snapshot</text>`));
  if(format==='PNG'){
   if(pages.length>12)throw Error('REPORT_IMAGE_LIMIT');
   const combined=svg(sheets.map((part,i)=>`<g transform="translate(0 ${i*height})"><rect width="${width}" height="${height}" fill="white"/>${part}<text x="40" y="1092" font-family="DejaVu Sans" font-size="10">${brand.showAveridi?'Averidi Dashboard · ':''}Page ${i+1} of ${sheets.length} · Governed source snapshot</text></g>`).join(''),height*pages.length);
   doc.end();await completed;const png=await renderAsync(combined,{font:{fontFiles:[font],loadSystemFonts:false,defaultFontFamily:'DejaVu Sans'},background:'white',logLevel:'off'},signal);const bytes=Buffer.from(png.asPng());if(bytes.length>32*1024*1024)throw Error('REPORT_OUTPUT_LIMIT');return {bytes,pages:pages.length};
  }
  for(const p of pages){signal?.throwIfAborted();doc.addPage({size:[width,height],margin:0});SVGtoPDF(doc as unknown as Parameters<typeof SVGtoPDF>[0],p,0,0,{assumePt:true,width,height,fontCallback:()=> 'ReportFont',imageCallback:link=>{if(!brand.logoDataUrl||link!==brand.logoDataUrl)throw Error('INVALID_REPORT_IMAGE');return link;},documentCallback:()=>{throw Error('INVALID_REPORT_RESOURCE');}});}
  doc.end();const bytes=await completed;signal?.throwIfAborted();return {bytes,pages:pages.length};
 }catch(error){doc.destroy();throw error;}
}
