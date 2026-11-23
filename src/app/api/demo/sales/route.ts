import {NextResponse} from 'next/server';
import {buildSalesDemo} from '../../../../features/demo/sales';
export async function POST(request:Request){
 try{const text=await request.text();if(text.length>12000)return NextResponse.json({error:'INVALID_SAMPLE_QUERY'},{status:413});return NextResponse.json(buildSalesDemo(JSON.parse(text)),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'INVALID_SAMPLE_QUERY'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
