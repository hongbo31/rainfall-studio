import {z} from 'zod';
const empty=z.strictObject({}),job=z.strictObject({jobId:z.uuid()});
export const MaterialMethods={
 'materials.list':empty,'materials.chooseDirectory':empty,
 'materials.scan':z.strictObject({sourceId:z.uuid()}),
 'materials.enqueue':z.strictObject({materialIds:z.array(z.uuid()).min(1).max(1000),expectedRevisions:z.record(z.uuid(),z.number().int().positive()),requestId:z.uuid(),profileId:z.uuid(),profileRevision:z.number().int().positive(),modelId:z.string().trim().min(1).max(200),artistId:z.uuid(),budgetCredits:z.number().finite().positive().max(1000000),consent:z.literal(true),regenerate:z.boolean().optional()}),
 'materials.pause':empty,'materials.resume':empty,'materials.retry':job,'materials.reconcile':job,
 'materials.selectVersion':z.strictObject({materialId:z.uuid(),versionId:z.uuid()}),
};
