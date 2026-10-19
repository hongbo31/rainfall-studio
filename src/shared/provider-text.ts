import {z} from 'zod';
import {CreativeDraftSchema} from './creation';
import {TextPricingSchema,type TextPricing} from './api-profiles';
import {TextEvaluationScoreSchema,TextEvaluationResponseSchema,textEvaluationOverall,type TextEvaluationScore} from './text-evaluation';
import {PairSchema} from '../core/quality/contracts';
const id=z.string().trim().min(1).max(1000),revision=z.number().int().positive(),money=z.number().int().nonnegative().max(1_000_000_000_000),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ProviderTextPrepareSchema=z.strictObject({ownerKey:id,runId:id,itemId:id,artistId:id,profileId:z.uuid(),profileRevision:revision,modelId:z.string().trim().min(1).max(200),budgetMicros:money.refine(v=>v>0),maxOutputTokens:z.number().int().min(256).max(16384),theme:z.string().max(16000),styleTemplate:z.string().max(20000),threshold:z.number().min(0).max(100),maxRewrites:z.number().int().min(0).max(2),maxScoreRetries:z.number().int().min(0).max(2),consent:z.literal(true)});
export type ProviderTextPrepare=z.infer<typeof ProviderTextPrepareSchema>;
export const ProviderTextUsageSchema=z.strictObject({promptTokens:z.number().int().nonnegative().max(10_000_000),completionTokens:z.number().int().nonnegative().max(10_000_000),cachedTokens:z.number().int().nonnegative().max(10_000_000)}).refine(u=>u.cachedTokens<=u.promptTokens);
export const ProviderTextRequestSchema=z.strictObject({operationId:z.uuid(),jobId:z.uuid(),ownerKey:id,providerId:z.enum(['deepseek','doubao']),profileId:z.uuid(),profileRevision:revision,modelId:z.string().trim().min(1).max(200),phase:z.enum(['generate','score','rewrite']),maxOutputTokens:z.number().int().min(256).max(16384),messages:z.array(z.strictObject({role:z.enum(['system','user']),content:z.string().min(1).max(200000)})).length(2),revisionId:z.uuid().nullable(),pairHash:hash.nullable(),price:TextPricingSchema});
export type ProviderTextRequest=z.infer<typeof ProviderTextRequestSchema>;
export const ProviderTextResultSchema=z.strictObject({operationId:z.uuid(),providerId:z.enum(['deepseek','doubao']),requestedModelId:z.string().min(1).max(200),status:z.enum(['complete','invalid','unknown']),providerRequestId:z.string().min(1).max(500).nullable(),providerModel:z.string().min(1).max(200).nullable(),finishReason:z.string().max(100).nullable(),httpStatus:z.number().int().min(100).max(599).nullable(),usage:ProviderTextUsageSchema.nullable(),content:z.string().max(1_000_000).nullable(),reason:z.string().regex(/^[A-Z0-9_]+$/).max(100).nullable()});
export type ProviderTextResult=z.infer<typeof ProviderTextResultSchema>;
export const ProviderTextOperationSchema=z.strictObject({id:z.uuid(),kind:z.literal('provider_text'),jobId:z.uuid(),ownerKey:id,runId:id,itemId:id,artistId:id,profileId:z.uuid(),profileRevision:revision,providerId:z.enum(['deepseek','doubao']),phase:z.enum(['generate','score','rewrite']),state:z.enum(['dispatching','complete','invalid','unknown']),request:ProviderTextRequestSchema,requestHash:hash,reservedMicros:money,costMicros:money.nullable(),currency:z.enum(['USD','CNY']),result:ProviderTextResultSchema.nullable(),createdAt:z.string(),updatedAt:z.string()});
export type ProviderTextOperation=z.infer<typeof ProviderTextOperationSchema>;
export const ProviderTextVersionSchema=z.strictObject({id:z.uuid(),draft:CreativeDraftSchema,pair:PairSchema,pairHash:hash,generationOperationId:z.uuid(),scoreOperationId:z.uuid().nullable(),score:TextEvaluationScoreSchema.nullable()});
export type ProviderTextVersion=z.infer<typeof ProviderTextVersionSchema>;
export const ProviderTextJobSchema=ProviderTextPrepareSchema.extend({id:z.uuid(),kind:z.literal('provider_text'),inputHash:hash,planId:id,planRevision:revision,providerId:z.enum(['deepseek','doubao']),currency:z.enum(['USD','CNY']),price:TextPricingSchema,phase:z.enum(['generate','score','rewrite']),state:z.enum(['ready','dispatching','complete','rejected','unknown','stopped','blocked']),stopRequested:z.boolean(),draft:CreativeDraftSchema.nullable(),draftId:z.uuid().nullable(),pair:PairSchema.nullable(),pairHash:hash.nullable(),score:TextEvaluationScoreSchema.nullable(),versions:z.array(ProviderTextVersionSchema).max(3),generationOperationId:z.uuid().nullable(),scoreOperationId:z.uuid().nullable(),operationId:z.uuid().nullable(),operations:z.array(z.uuid()).max(20),rewrites:z.number().int().nonnegative(),scoreRetries:z.number().int().nonnegative(),spentMicros:money,reservedMicros:money,reason:z.string().max(100).nullable(),createdAt:z.string(),updatedAt:z.string()});
export type ProviderTextJob=z.infer<typeof ProviderTextJobSchema>;
export const ProviderTextIdSchema=z.strictObject({id:z.uuid()});
export const ProviderTextRecordSchema=z.strictObject({id:z.uuid(),operationId:z.uuid(),result:ProviderTextResultSchema});
export const ProviderTextStopSchema=z.strictObject({ownerKey:id});
export const ProviderTextNoteSchema=z.strictObject({id:z.uuid(),reason:z.enum(['CREDENTIAL_REQUIRED','SECURE_STORAGE_UNAVAILABLE','TEXT_TRANSPORT_UNAVAILABLE','TEXT_PROFILE_OR_PRICE_REQUIRED','REVISION_CONFLICT','TEXT_CONFIGURATION_UNAVAILABLE'])});
export function providerTextCost(price:TextPricing,usage:{promptTokens:number;completionTokens:number}) {
 const p=TextPricingSchema.parse(price);if(!Number.isSafeInteger(usage.promptTokens)||!Number.isSafeInteger(usage.completionTokens)||usage.promptTokens<0||usage.completionTokens<0)throw Error('TEXT_USAGE_RANGE');
 const numerator=BigInt(usage.promptTokens)*BigInt(p.inputMicrosPerMillionTokens)+BigInt(usage.completionTokens)*BigInt(p.outputMicrosPerMillionTokens);
 const value=Number((numerator+999999n)/1000000n);
 if(!Number.isSafeInteger(value)||value>1_000_000_000_000)throw Error('TEXT_COST_RANGE');return value;
}
export function providerTextModelMatches(request:ProviderTextRequest,model:string|null){return model!==null&&request.price.modelId===request.modelId&&request.price.responseModelIds.includes(model);}
export function parseProviderTextScore(raw:unknown,request:{revisionId:string;threshold:number;pair:{lyrics:string;musicPrompt:string};intent:string}):TextEvaluationScore{
 const r=TextEvaluationResponseSchema.parse(raw);if(r.revisionId!==request.revisionId)throw Error('TEXT_SCORE_REVISION_MISMATCH');
 for(const finding of r.findings){const plainQuotes=[...finding.matchAll(/[“「]([^”」]+)[”」]|"([^"\n]+)"/g)];
  const sources=[request.pair.lyrics,request.pair.musicPrompt,request.intent];
  if(!plainQuotes.some(q=>[...(q[1]??q[2])].length>=4&&sources.some(s=>s.includes(q[1]??q[2])))||finding.replace(/[“「]([^”」]+)[”」]|"([^"\n]+)"/g,'').replace(/[\p{P}\p{Z}\p{S}]/gu,'').length<8)throw Error('TEXT_SCORE_EVIDENCE_INVALID');
 }
 const overall=textEvaluationOverall(r.dimensions);return TextEvaluationScoreSchema.parse({...r,overall,threshold:request.threshold,passed:overall>=request.threshold,source:'model-scored',calibration:'not_human_calibrated'});
}
