import { z } from "zod";
import type {CredentialFailureCode} from './credential-errors';

export const textProviderBaseUrls = Object.freeze({deepseek:'https://api.deepseek.com',doubao:'https://ark.cn-beijing.volces.com/api/v3'});
export const openAiCoverModel = "gpt-image-2.6-flare";
export const zhipuCoverModel = "cogview-3-flash";
export const glmImageCoverModel = "glm-image";
export const glmImageCoverPrice = "¥0.10/次";
export const seedream55CoverModel = "doubao-seedream-5-5-261028";
export const seedream50ProCoverModel = "doubao-seedream-5-0-pro-260628";
export const doubaoCoverEndpoint = textProviderBaseUrls.doubao + "/images/generations";
export const doubaoCoverSize = "1536x1536";
export const zhipuCoverEndpoint = "https://open.bigmodel.cn/api/paas/v4/images/generations";
export const zhipuCoverDownloadHosts = [
  "sfile.chatglm.cn",
  "cdn.bigmodel.cn",
  "maas-watermark-prod-new.cn-wlcb.ufileos.com",
] as const;
const imageModels = {
  openai_image: [
    { id: openAiCoverModel, label: "GPT Image 2.6 Flare" },
    { id: "gpt-image-2.6-sunburst", label: "GPT Image 2.6 Sunburst" },
  ],
  zhipu_image: [
    { id: zhipuCoverModel, label: "CogView-3-Flash（免费）" },
    { id: glmImageCoverModel, label: `GLM-Image（${glmImageCoverPrice}）` },
  ],
  doubao_image: [
    { id: seedream55CoverModel, label: "Doubao Seedream 5.5" },
    { id: seedream50ProCoverModel, label: "Doubao Seedream 5.0 Pro" },
  ],
} as const;

export function imageApiModels(providerId: string | null): readonly { id: string; label: string }[] {
  return providerId && Object.hasOwn(imageModels, providerId) ? imageModels[providerId as keyof typeof imageModels] : [];
}

export function imageApiModel(providerId: string | null) {
  return imageApiModels(providerId)[0]?.id ?? null;
}

export function supportsImageApiModel(providerId: string | null, modelId: string | null | undefined): modelId is string {
  return imageApiModels(providerId).some(option => option.id === modelId);
}

export type ManualCoverModel = { providerId: "zhipu_image" | "doubao_image"; modelId: string };

export function supportsManualCover(providerId: string | null | undefined): providerId is ManualCoverModel["providerId"] {
  return providerId === "zhipu_image" || providerId === "doubao_image";
}

export const manualCoverPrices = {
  [glmImageCoverModel]: glmImageCoverPrice,
  [seedream55CoverModel]: "参考 ¥0.13/张",
  [seedream50ProCoverModel]: "参考 ¥0.30/张",
} as const;
export type PaidCoverModelId = keyof typeof manualCoverPrices;

export function paidCoverModelId(modelId: string | null | undefined): PaidCoverModelId | undefined {
  return modelId && Object.hasOwn(manualCoverPrices, modelId) ? modelId as PaidCoverModelId : undefined;
}

export const TextPricingSchema = z.strictObject({
  currency:z.enum(['USD','CNY']), modelId:z.string().trim().min(1).max(200),
  inputMicrosPerMillionTokens:z.number().int().nonnegative().max(1_000_000_000_000),
  outputMicrosPerMillionTokens:z.number().int().positive().max(1_000_000_000_000),
  source:z.string().trim().min(1).max(2000),version:z.string().trim().min(1).max(200),
  responseModelIds:z.array(z.string().trim().min(1).max(200)).min(1).max(20),
});
export type TextPricing = z.infer<typeof TextPricingSchema>;

export const textApiModelCatalogs = {
  deepseek: {
    source: "https://api-docs.deepseek.com/quick_start/pricing/",
    version: "2026-11-22（高峰未缓存）",
    models: [
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash-1017", inputPrice: 0.3, outputPrice: 1.2 },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro-0813", inputPrice: 1.32, outputPrice: 3.96 },
    ],
  },
  doubao: {
    source: "https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing",
    version: "2026-11-22（常规文本）",
    models: [
      { id: "doubao-seed-2-1-pro-260915", label: "Doubao Seed 2.1 Pro", inputPrice: 6, outputPrice: 30 },
      { id: "doubao-seed-2-1-lite-260915", label: "Doubao Seed 2.1 Lite", inputPrice: 0.8, outputPrice: 2.7 },
    ],
  },
} as const;

const apiProfileMetadataSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["text", "image", "music"]),
    providerId: z.enum([
      "text_pending",
      "deepseek",
      "doubao",
      "codex_cli",
      "claude_code",
      "yourmusic",
      "suno",
      "miaoxiang",
      "image_pending", "dot_image", "local_image", "openai_image", "zhipu_image", "doubao_image",
    ]),
    label: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(200).nullable(),
    baseUrl:z.string().max(2000).nullable().optional(),
    textPricing:TextPricingSchema.nullable().optional(),
    executionEnabled: z.literal(false),
  })
  .refine(
    (p) => p.kind === (["text_pending","deepseek","doubao","codex_cli","claude_code"].includes(p.providerId)?'text':['image_pending','dot_image','local_image','openai_image','zhipu_image','doubao_image'].includes(p.providerId)?'image':'music'),
    {
      message: "PROFILE_KIND_MISMATCH",
    },
  ).superRefine((p,ctx)=>{
    const fixed=textProviderBaseUrls[p.providerId as keyof typeof textProviderBaseUrls]??null;
    if(imageApiModel(p.providerId)&&!supportsImageApiModel(p.providerId,p.modelId))
      ctx.addIssue({code:'custom',message:'IMAGE_MODEL_REQUIRED',path:['modelId']});
    if(p.baseUrl!==undefined&&p.baseUrl!==fixed)ctx.addIssue({code:'custom',message:'TEXT_ENDPOINT_REJECTED',path:['baseUrl']});
    if(p.textPricing&&(p.kind!=='text'||!fixed||p.textPricing.modelId!==p.modelId||p.textPricing.currency!==(p.providerId==='doubao'?'CNY':'USD')))
      ctx.addIssue({code:'custom',message:'TEXT_PRICE_SCOPE',path:['textPricing']});
  });
const normalizeProfile=<T extends {providerId:string;baseUrl?:string|null}>(p:T)=>({...p,...(p.providerId in textProviderBaseUrls?{baseUrl:textProviderBaseUrls[p.providerId as keyof typeof textProviderBaseUrls]}:{})});
export const apiProfileInputSchema=apiProfileMetadataSchema.transform(normalizeProfile);
export const apiProfileSchema = apiProfileMetadataSchema.safeExtend({
  revision: z.number().int().positive(),
}).transform(normalizeProfile);
export const saveApiProfileSchema = z.strictObject({
    profile: apiProfileInputSchema.transform(normalizeProfile),
  expectedRevision: z.number().int().positive().nullable(),
});
export type ApiProfile = z.infer<typeof apiProfileSchema>;
export type SaveApiProfileInput = z.infer<typeof saveApiProfileSchema>;
export type ApiConnectionCheck = {
  profileId: string;
  providerId: "yourmusic" | "deepseek" | import("./platform-image").ImageApiProviderId;
  state: "connected" | "unauthorized" | "forbidden" | "credits_required" | "rate_limited" | "unavailable" | "invalid_response";
  httpStatus: number | null;
  failureCode: "HTTP_DNS_FAILED" | "HTTP_TLS_FAILED" | "CREDENTIAL_FORMAT_INVALID" | "HTTP_ACCESS_DENIED" | "HTTP_ADDRESS_REJECTED" | "HTTP_TIMEOUT" | "HTTP_SIZE_LIMIT" | "HTTP_REQUEST_FAILED" | null;
  checkedAt: string;
  scope: "authentication_only";
  paidGenerationRequested: false;
};

// A capability catalogue, not an HTTP client. No renderer-supplied base URL.
export const apiProviders = Object.freeze([
  {
    id: "deepseek",
    kind: "text",
    name: "DeepSeek",
    state: "官方 API · 逐轮预算授权后调用",
    credentialInput: true,
    hosts: ["api.deepseek.com"],
  },
  {
    id: "doubao",kind:"text",name:"豆包 / 火山方舟",state:"官方文本 API · 按计划授权执行",credentialInput:true,hosts:["ark.cn-beijing.volces.com"],
  },
  {
    id: "codex_cli",
    kind: "text",
    name: "Codex CLI / SDK",
    state: "可选 · 本地适配器未配置",
    credentialInput: false,
    hosts: [],
  },
  {
    id: "claude_code",
    kind: "text",
    name: "Claude Code / SDK",
    state: "可选 · 本地适配器未配置",
    credentialInput: false,
    hosts: [],
  },
  {
    id: "text_pending",
    kind: "text",
    name: "文本模型",
    state: "未配置",
    credentialInput: false,
    hosts: [],
  },
  {id:'openai_image',kind:'image',name:'OpenAI 封面生成',state:'按首生成 · 使用 API 额度',credentialInput:true,hosts:['api.openai.com']},
  {id:'zhipu_image',kind:'image',name:'智谱 AI',state:'智谱图像生成 API',credentialInput:true,hosts:['open.bigmodel.cn']},
  {id:'doubao_image',kind:'image',name:'豆包 / 火山方舟',state:'火山方舟图像生成 API',credentialInput:true,hosts:['ark.cn-beijing.volces.com']},
  {id:'local_image',kind:'image',name:'本地图片导入',state:'真实图片导入 · 不调用模型',credentialInput:false,hosts:[]},
  {id:'dot_image',kind:'image',name:'dot 外部出图后导入',state:'外部会话生成 · 客户端不直接调用',credentialInput:false,hosts:[]},
  {id:'image_pending',kind:'image',name:'图片 API（待接入）',state:'图像适配器未接入',credentialInput:false,hosts:[]},
  {
    id: "yourmusic",
    kind: "music",
    name: "谱乐 AI",
    state: "API 文档已核实 · 客户端未联调",
    musicApiChannel: "pule",
    credentialInput: true,
    hosts: ["api.yourmusic.fun"],
  },
  {
    id: "suno",
    kind: "music",
    name: "Suno",
    state: "API 合同待核验",
    credentialInput: false,
    hosts: ["platform.suno.com"],
  },
  {
    id: "miaoxiang",
    kind: "music",
    name: "妙响",
    state: "API 接入待确认",
    credentialInput: false,
    hosts: [],
  },
] as const);

export function musicApiChannel(providerId: string) {
  const provider = apiProviders.find(candidate => candidate.id === providerId);
  return provider && "musicApiChannel" in provider ? provider.musicApiChannel : undefined;
}

export function canStoreApiCredential(profile: ApiProfile) {
  return apiProviders.some(
    (p) => p.id === profile.providerId && p.credentialInput,
  );
}

export const credentialIdentitySchema = z.strictObject({
  profileId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});
export const credentialInputSchema = credentialIdentitySchema.extend({
  secret: z.string().min(1).max(100000),
});
export const credentialStatusInputSchema = z.strictObject({
  profileId: z.uuid(),
  includeMaskedKey: z.literal(true).optional(),
});
export type CredentialInput = z.infer<typeof credentialInputSchema>;
export type CredentialIdentity = z.infer<typeof credentialIdentitySchema>;
export type CredentialStatusInput = z.infer<typeof credentialStatusInputSchema>;
export type CredentialStatus = {
  profileId: string;
  state: "absent" | "stored_unverified" | "unavailable";
  configured: boolean;
  maskedKey?: string;
  failureCode?: CredentialFailureCode;
};
