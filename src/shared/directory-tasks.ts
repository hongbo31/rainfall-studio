import {z} from 'zod';
const logicalId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/).refine(v=>!v.endsWith('.')&&!/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(v),'RESERVED_REQUEST_ID');
const revision=z.number().int().positive().max(1_000_000);
const planId=z.string().trim().min(1).max(500);
export const DirectoryTaskRequestSchema=z.strictObject({schemaVersion:z.literal(1),requestId:logicalId,revision,planId,planRevision:revision});
export const DirectoryTaskReadySchema=z.strictObject({schemaVersion:z.literal(1),requestId:logicalId,revision,requestSha256:z.string().regex(/^[a-f0-9]{64}$/)});
export const DirectoryTaskIdentitySchema=z.strictObject({id:z.uuid(),expectedRevision:revision});
export const DirectoryTaskChooseSchema=z.strictObject({id:z.uuid().optional(),expectedRevision:revision.optional()}).refine(v=>Boolean(v.id)===Boolean(v.expectedRevision));
export const DirectoryTaskConfigureSchema=z.strictObject({id:z.uuid().optional(),expectedRevision:revision.nullable(),root:z.string().min(1).max(32760)});
export const DirectoryTaskSaveSchema=DirectoryTaskIdentitySchema.extend({planId,planRevision:revision,intervalSeconds:z.number().int().min(5).max(86400),readiness:z.enum(['stable-json','ready-package'])});
export const DirectoryTaskSchemas:Record<string,z.ZodType>={
 'directoryTasks.status':z.strictObject({}),'directoryTasks.chooseDirectory':DirectoryTaskChooseSchema,
 'directoryTasks.save':DirectoryTaskSaveSchema,'directoryTasks.pause':DirectoryTaskIdentitySchema,
 'directoryTasks.resume':DirectoryTaskIdentitySchema,'directoryTasks.scanNow':DirectoryTaskIdentitySchema,'directoryTasks.stop':DirectoryTaskIdentitySchema,
};
export type DirectoryTaskRequest=z.infer<typeof DirectoryTaskRequestSchema>;
export type DirectoryTaskSource={id:string;revision:number;root:string;rootIdentity:{dev:string;ino:string};enabled:boolean;intervalSeconds:number;readiness:'stable-json'|'ready-package';planId:string|null;planRevision:number|null;authorizationHash:string|null;createdAt:string;updatedAt:string;lastScanAt?:string;scanCursor?:string;error?:string;};
export type DirectoryTaskEntry={id:string;sourceId:string;sourceRootIdentity:string;request:DirectoryTaskRequest;semanticHash:string;payloadSha256:string;state:'queued'|'bound'|'completed'|'blocked'|'stopped';runId?:string;error?:string;createdAt:string;updatedAt:string};
