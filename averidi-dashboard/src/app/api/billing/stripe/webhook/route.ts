import {processBillingWebhook} from '../../../../../features/billing/service';
import {rawBillingBody,billingJson,billingError} from '../../../../../features/billing/http';
export const runtime='nodejs';
export async function POST(request:Request){try{return billingJson(await processBillingWebhook(await rawBillingBody(request),request.headers.get('stripe-signature')??''));}catch(error){return billingError(error);}}
