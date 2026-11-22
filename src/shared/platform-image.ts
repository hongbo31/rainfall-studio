import { z } from "zod";
import { apiProviders, credentialIdentitySchema, textProviderBaseUrls, type ApiProfile } from "./api-profiles";
import { coverResolutionSchema } from "./cover-handoff";
import { credentialFailureMessages } from "./credential-errors";
import { PlatformTargetSchema } from "./platform-config";

const imageProviderSchema = z.enum(["openai_image", "zhipu_image", "doubao_image"]);
export type ImageApiProviderId = z.infer<typeof imageProviderSchema>;
export const imageCredentialCheckEndpoints = Object.freeze({
  openai_image: "https://api.openai.com/v1/models",
  zhipu_image: "https://open.bigmodel.cn/api/paas/v4/files?purpose=batch&limit=1",
  doubao_image: textProviderBaseUrls.doubao + "/models",
} satisfies Record<ImageApiProviderId, string>);
export const imageApiProviders = apiProviders.flatMap(provider => {
  const id = imageProviderSchema.safeParse(provider.id);
  return id.success ? [{ id: id.data, name: provider.name }] : [];
});
export type ImageApiProvider = (typeof imageApiProviders)[number];

export function imageCredentialProfiles(profiles: readonly ApiProfile[], providerId: ImageApiProviderId,
  defaultProfileId: string | null | undefined) {
  return profiles.filter(profile => profile.kind === "image" && profile.providerId === providerId)
    .sort((left, right) => Number(right.id === defaultProfileId) - Number(left.id === defaultProfileId) || left.id.localeCompare(right.id));
}

export const imageSelectionSchema = credentialIdentitySchema.extend({
  providerId: imageProviderSchema,
  modelId: z.string().min(1).max(200),
});
export const imageChoiceSchema = imageSelectionSchema.omit({ expectedRevision: true });
export type ImageSelection = z.infer<typeof imageSelectionSchema>;
export type ImageChoice = z.infer<typeof imageChoiceSchema>;
export const imagePromptLimit = 1000;
export const platformImageSchemas = {
  "platformImage.prepareCredential": z.strictObject({ providerId: imageProviderSchema }),
  "platformImage.setDefault": imageSelectionSchema.extend({ onlyIfUnset: z.literal(true).optional() }),
  "platformImage.generate": imageSelectionSchema.extend({
    platform: PlatformTargetSchema,
    artistId: z.uuid(),
    resolution: coverResolutionSchema,
    prompt: z.string().trim().min(1).max(imagePromptLimit),
  }),
};

export type PlatformImageResult = { base64: string; filename: string; resolution: number };
export type PlatformImageScope = { artistName: string; resolution: number };

const imageFailureMessages: Record<string, string> = {
  ...credentialFailureMessages,
  PRODUCTION_REQUIRED: "请在真实本地库出图",
  IMAGE_PROFILE_REQUIRED: "请重新选择图像模型并核对 API Key",
  IMAGE_MODEL_REQUIRED: "所选模型不可用，请重新选择",
  IMAGE_ARTIST_PLATFORM_MISMATCH: "艺人的发布平台已变化，请重新选择",
  IMAGE_RESOLUTION_REQUIRED: "请在账号管理设置艺人的封面分辨率",
  IMAGE_RESOLUTION_CHANGED: "艺人的封面分辨率已变化，请刷新后重试",
  IMAGE_GENERATION_BUSY: "该提供商已有出图请求正在执行",
  IMAGE_HTTP_400: "提供商拒绝出图参数，请检查所选模型和创意描述",
  IMAGE_HTTP_401: "API Key 认证失败，请在配置中心核对密钥",
  IMAGE_HTTP_402: "提供商返回额度不足，请检查账号余额",
  IMAGE_HTTP_403: "请求被拒绝，请检查模型开通状态和权限",
  IMAGE_HTTP_429: "图像服务限流，请稍后重试",
  IMAGE_DOWNLOAD_FAILED: "生成结果下载失败，请检查网络",
  IMAGE_DOWNLOAD_URL_REJECTED: "生成结果的下载地址校验失败",
  IMAGE_DIMENSIONS: "生成图片的分辨率异常",
  IMAGE_RESPONSE_INVALID: "图像服务返回的图片无效",
  IMAGE_OUTCOME_UNKNOWN: "图像服务未返回生成结果",
  HTTP_TIMEOUT: "图像服务请求超时",
  HTTP_REQUEST_FAILED: "图像服务连接失败，请检查网络",
  IMAGE_OPERATION_FAILED: "出图未完成，请检查模型配置后重试",
};

export function platformImageFailure(error: unknown) {
  const code = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (Object.hasOwn(imageFailureMessages, code)) return { code, message: imageFailureMessages[code] };
  if (/^IMAGE_HTTP_4\d{2}$/u.test(code)) return { code, message: "图像服务拒绝请求" };
  return { code: "IMAGE_OPERATION_FAILED", message: imageFailureMessages.IMAGE_OPERATION_FAILED };
}
