import {z} from 'zod';
const currencies=new Set(Intl.supportedValuesOf('currency'));
export const workspacePresentationSchema=z.object({
 currency:z.string().regex(/^[A-Z]{3}$/).refine(value=>currencies.has(value),'Choose a supported ISO currency.'),
 timezone:z.string().min(1).max(100).refine(value=>{try{return /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)&&!!new Intl.DateTimeFormat('en-US',{timeZone:value}).resolvedOptions().timeZone;}catch{return false;}},'Choose a named IANA timezone.'),
 locale:z.string().min(2).max(80).refine(value=>{try{return Intl.getCanonicalLocales(value).length===1&&Intl.DateTimeFormat.supportedLocalesOf([value]).length===1&&Intl.NumberFormat.supportedLocalesOf([value]).length===1;}catch{return false;}},'Choose a supported date/number locale.'),
}).strict().transform(value=>({...value,locale:Intl.getCanonicalLocales(value.locale)[0]}));
export type WorkspacePresentation=z.infer<typeof workspacePresentationSchema>;
export const presentationChangeSchema=z.object({presentation:workspacePresentationSchema,expectedRevision:z.number().int().min(0).max(2147483646)}).strict();
