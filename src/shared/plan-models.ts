import {z} from 'zod';

// Retained integration contract; this is installed support, never account discovery.
export const planMusicModelIds = ['chirp-v6','chirp-v6-wild','chirp-v6-mini'] as const;
export const planModelEvidenceTtlMs = 24 * 60 * 60 * 1000;
export const planMusicModelContract = Object.freeze({
  source:'https://api.yourmusic.fun/v1/openapi.json?lang=zh',
  document:'docs/integrations/yourmusic-contract-2026-10-16.json',
  version:'1.0.0',
  checkedAt:'2026-10-16T11:04:24.5531722Z',
});
export const planModelEvidenceSchema = z.strictObject({
  profileId:z.uuid(),
  profileRevision:z.number().int().positive(),
  providerId:z.literal('yourmusic'),
  source:z.literal('yourmusic_history'),
  scope:z.literal('historical_success_only'),
  range:z.strictObject({page:z.literal(1),size:z.literal(20)}),
  observedAt:z.iso.datetime(),
  expiresAt:z.iso.datetime(),
  models:z.array(z.strictObject({
    modelId:z.enum(planMusicModelIds),
    status:z.literal('account-observed-success'),
  })).max(planMusicModelIds.length),
}).refine(e=>new Set(e.models.map(m=>m.modelId)).size===e.models.length, 'DUPLICATE_MODEL_EVIDENCE')
  .refine(e=>Date.parse(e.expiresAt)-Date.parse(e.observedAt)===planModelEvidenceTtlMs,'MODEL_EVIDENCE_TTL');
export const recordPlanModelEvidenceSchema=z.strictObject({evidence:planModelEvidenceSchema});
export type PlanModelEvidence=z.infer<typeof planModelEvidenceSchema>;
export type PlanModelCatalogEntry={
  id:typeof planMusicModelIds[number];
  modelId:typeof planMusicModelIds[number];
  label:string;
  providerId:'yourmusic';
  profileId:string|null;
  profileRevision:number|null;
  contractStatus:'contract-supported';
  accountStatus:'account-observed-success'|'unknown'|'stale';
  verified:false;
  currentAvailability:'unknown';
  contract:typeof planMusicModelContract;
  evidence:PlanModelEvidence|null;
};
