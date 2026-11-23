import {NextResponse} from 'next/server';
import {dashboardContractArtifacts} from '../../../../../contracts/manifest';
export function GET(){return NextResponse.json({enabled:false,contractVersion:'1.0',...dashboardContractArtifacts()},{headers:{'Cache-Control':'no-store','X-Dashboard-Contract-Version':'1.0'}});}
