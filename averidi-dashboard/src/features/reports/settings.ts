import {z} from 'zod';
import {analysisQuerySchema} from '../../engines/analysis/query-contracts';
export const reportFormatSchema=z.enum(['CSV','PDF','PNG']);
export type ReportFormat=z.infer<typeof reportFormatSchema>;
export const reportBrandingSchema=z.object({
 businessName:z.string().trim().max(120).default(''),
 subtitle:z.string().trim().max(240).default(''),
 accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#245b88'),
 showAveridi:z.boolean().default(true),
 logoDataUrl:z.string().max(32768).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable().default(null),
}).strict();
export type ReportBranding=z.infer<typeof reportBrandingSchema>;
export const reportSettingsSchema=z.object({query:analysisQuerySchema.optional(),expiresAt:z.string().datetime({offset:true}).optional(),branding:reportBrandingSchema.optional()}).strict();
export const REPORT_TYPES={CSV:{mime:'text/csv; charset=utf-8',extension:'csv'},PDF:{mime:'application/pdf',extension:'pdf'},PNG:{mime:'image/png',extension:'png'}} as const;
