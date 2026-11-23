import {erasureAdmissionCode} from '../account-erasure/errors';
import {NextResponse} from 'next/server';
import {quotaFailure} from './contracts';
export function quotaHttpError(error:unknown){const erasure=erasureAdmissionCode(error);if(erasure)return NextResponse.json({error:erasure},{status:409,headers:{'Cache-Control':'private, no-store'}});if(error instanceof Error&&error.message==='CONFIGURATION_ACTION_DISABLED')return NextResponse.json({error:'CONFIGURATION_ACTION_DISABLED'},{status:403,headers:{'Cache-Control':'private, no-store'}});const resource=quotaFailure(error);return resource?NextResponse.json({error:'QUOTA_EXCEEDED',resource},{status:409,headers:{'Cache-Control':'private, no-store'}}):null;}
