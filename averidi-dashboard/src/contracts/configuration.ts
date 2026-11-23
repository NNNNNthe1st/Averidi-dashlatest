import {z} from 'zod';
export const admissionSettingKeys=['WORKSPACE_CREATION_ENABLED','ORGANIZATION_CREATION_ENABLED','WORKSPACE_INVITATIONS_ENABLED','ORGANIZATION_INVITATIONS_ENABLED','SHARE_LINK_CREATION_ENABLED','SCHEDULE_CREATION_ENABLED'] as const;
export type AdmissionSetting=typeof admissionSettingKeys[number];
export const configurationCatalog={
 SUPPORT_CASE_CREATION_ENABLED:{default:true,schema:z.boolean(),description:'Allow new customer support cases.'},
 SUPPORT_MAX_OPEN_CASES_PER_USER:{default:20,schema:z.number().int().min(1).max(1000),description:'Maximum open or in-progress support cases per workspace and requester.'},
 WORKSPACE_CREATION_ENABLED:{default:true,schema:z.boolean(),description:'Allow creation of new customer workspaces.'},
 ORGANIZATION_CREATION_ENABLED:{default:true,schema:z.boolean(),description:'Allow creation of new customer organizations.'},
 WORKSPACE_INVITATIONS_ENABLED:{default:true,schema:z.boolean(),description:'Allow new workspace invitations and acceptance of existing invitations.'},
 ORGANIZATION_INVITATIONS_ENABLED:{default:true,schema:z.boolean(),description:'Allow new organization invitations and acceptance of existing invitations.'},
 SHARE_LINK_CREATION_ENABLED:{default:true,schema:z.boolean(),description:'Allow creation of new workspace-member share links. Existing links and direct grants retain their access rules.'},
 SCHEDULE_CREATION_ENABLED:{default:true,schema:z.boolean(),description:'Allow new job, connector and report schedules. Existing enabled schedules continue; disabling remains available.'},
} as const;
export const configurationKeys=Object.keys(configurationCatalog) as (keyof typeof configurationCatalog)[];
const reason=z.string().trim().min(8).max(500),revision=z.iso.datetime().nullable();
export const configurationChangeSchema=z.union([
 z.object({key:z.literal('SUPPORT_CASE_CREATION_ENABLED'),value:z.boolean(),reason,expectedUpdatedAt:revision.optional()}).strict(),
 z.object({key:z.literal('SUPPORT_MAX_OPEN_CASES_PER_USER'),value:z.number().int().min(1).max(1000),reason,expectedUpdatedAt:revision.optional()}).strict(),
 z.object({key:z.enum(admissionSettingKeys),value:z.boolean(),reason,expectedUpdatedAt:revision}).strict(),
]);
