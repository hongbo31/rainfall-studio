import { z } from "zod";

export const textProviderBaseUrls = Object.freeze({deepseek:'https://api.deepseek.com',doubao:'https://ark.cn-beijing.volces.com/api/v3'});
export const TextPricingSchema = z.strictObject({
  currency:z.enum(['USD','CNY']), modelId:z.string().trim().min(1).max(200),
  inputMicrosPerMillionTokens:z.number().int().nonnegative().max(1_000_000_000_000),
  outputMicrosPerMillionTokens:z.number().int().positive().max(1_000_000_000_000),
  source:z.string().trim().min(1).max(2000),version:z.string().trim().min(1).max(200),
  responseModelIds:z.array(z.string().trim().min(1).max(200)).min(1).max(20),
});
export type TextPricing = z.infer<typeof TextPricingSchema>;

const apiProfileMetadataSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["text", "music"]),
    providerId: z.enum([
      "text_pending",
      "deepseek",
      "doubao",
      "codex_cli",
      "claude_code",
      "yourmusic",
      "suno",
      "miaoxiang",
    ]),
    label: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(200).nullable(),
    baseUrl:z.string().max(2000).nullable().optional(),
    textPricing:TextPricingSchema.nullable().optional(),
    executionEnabled: z.literal(false),
  })
  .refine(
    (p) =>
      (p.kind === "text") ===
      ["text_pending", "deepseek", "doubao", "codex_cli", "claude_code"].includes(
        p.providerId,
      ),
    {
      message: "PROFILE_KIND_MISMATCH",
    },
  ).superRefine((p,ctx)=>{
    const fixed=textProviderBaseUrls[p.providerId as keyof typeof textProviderBaseUrls]??null;
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
  providerId: "yourmusic" | "deepseek";
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
  {
    id: "yourmusic",
    kind: "music",
    name: "谱乐 AI",
    state: "API 文档已核实 · 客户端未联调",
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
});
export type CredentialInput = z.infer<typeof credentialInputSchema>;
export type CredentialIdentity = z.infer<typeof credentialIdentitySchema>;
export type CredentialStatus = {
  profileId: string;
  state: "absent" | "stored_unverified" | "unavailable";
  configured: boolean;
};
