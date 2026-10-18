import { z } from "zod";

export const apiProfileInputSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["text", "music"]),
    providerId: z.enum([
      "text_pending",
      "deepseek",
      "codex_cli",
      "claude_code",
      "yourmusic",
      "suno",
      "miaoxiang",
    ]),
    label: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(200).nullable(),
    executionEnabled: z.literal(false),
  })
  .refine(
    (p) =>
      (p.kind === "text") ===
      ["text_pending", "deepseek", "codex_cli", "claude_code"].includes(
        p.providerId,
      ),
    {
      message: "PROFILE_KIND_MISMATCH",
    },
  );
export const apiProfileSchema = apiProfileInputSchema.safeExtend({
  revision: z.number().int().positive(),
});
export const saveApiProfileSchema = z.strictObject({
  profile: apiProfileInputSchema,
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
