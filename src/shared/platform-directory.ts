import { apiProviders, textProviderBaseUrls } from "./api-profiles";
import type { AccountProvider } from "./platform-accounts";
import { publicationPlatforms } from "./platform-config";
import { browserMusicProviders } from "./plan-workflow-fields";
import { puleCreateUrl, puleLoginUrl } from "./pule-browser";
import { qishuiOrigin, qishuiPublishUrl } from "./qishui";

export const sunoCnOrigin = "https://www.suno.cn";
const arkConsole = "https://ark.volcengine.com/region:cn-beijing/overview";

export const platformPageUrls = {
  fanqie: "https://www.novelfm.com/creator/music/home",
  netease: "https://music.163.com/st/musician",
  qishui: qishuiPublishUrl,
  qqmusic: "https://y.tencentmusic.com/",
  kugou: "https://y.tencentmusic.com/",
  tme: "https://y.tencentmusic.com/",
  douyin: "https://creator.douyin.com/",
  yourmusic: puleCreateUrl,
  suno: "https://suno.com",
  suno_cn: "https://11619989.share.suno.cn/home/#/?from=invite&invite_id=11619989",
  miaoxiang: qishuiOrigin + "/studio",
  deepseek: "https://platform.deepseek.com/",
  doubao: arkConsole,
  doubao_image: arkConsole,
  openai_image: "https://platform.openai.com/api-keys",
  zhipu_image: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
  codex_cli: "https://chatgpt.com/codex",
  claude_code: "https://claude.ai/code",
} as const;

export function platformAccountLoginUrl(provider: AccountProvider) {
  return provider === "yourmusic" ? puleLoginUrl : platformPageUrls[provider];
}

export type WorkflowNodeDefinition = {
  id: string;
  label: string;
  kind: "lyrics" | "creation" | "text" | "music" | "publish";
  available: boolean;
  reason?: string;
};

export type PublicationWorkflowHandler = NonNullable<(typeof publicationPlatforms)[number]["handler"]>;

export function publicationWorkflowHandler(target: string): PublicationWorkflowHandler | undefined {
  return publicationPlatforms.find(platform => platform.id === target)?.handler;
}

const providerNodes = apiProviders.flatMap<WorkflowNodeDefinition>(provider => {
  if (provider.kind === "image") return [];
  const available = provider.kind === "text"
    ? Object.hasOwn(textProviderBaseUrls, provider.id)
    : "musicApiChannel" in provider;
  return [{
    id: `${provider.kind}:${provider.id}`,
    label: provider.name,
    kind: provider.kind,
    available,
    ...(available ? {} : { reason: provider.state }),
  }];
});

export const workflowNodesCatalog: readonly WorkflowNodeDefinition[] = [
  { id: "lyrics", label: "AI作词", kind: "lyrics", available: true },
  { id: "creation", label: "创作中心", kind: "creation", available: true },
  ...providerNodes,
  { id: "music:suno_cn", label: browserMusicProviders.suno_cn.label, kind: "music", available: true },
  ...publicationPlatforms.map(({ id, label, handler }): WorkflowNodeDefinition => ({
    id: `publish:${id}`,
    label,
    kind: "publish",
    available: !!handler,
    ...(handler ? {} : { reason: "暂不支持工作流发布" }),
  })),
];
