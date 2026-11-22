import React, { useState } from "react";
import { imageApiModels, textProviderBaseUrls, type ApiProfile } from "../../shared/api-profiles";
import { accountSupportsTarget, type PlatformAccount } from "../../shared/platform-accounts";
import { PlatformTargetSchema, type PlatformConfiguration, type PlatformTarget } from "../../shared/platform-config";
import { publicationWorkflowHandler, workflowNodesCatalog, type WorkflowNodeDefinition } from "../../shared/platform-directory";
import { imageApiProviders, type ImageApiProvider } from "../../shared/platform-image";
import { names, PageHead, useStudio } from "../context";
import ApiSettings from "../components/ApiSettings";
import ImageGenerationDialog from "../components/ImageGenerationDialog";
import PlatformAutomationPanel from "../components/PlatformAutomationPanel";
import PlatformCardHeader, { usePlatformPage } from "../components/PlatformCardHeader";
import PuleBrowserGeneration from "../components/PuleBrowserGeneration";
import PublicationAutomationDialog from "../components/PublicationAutomationDialog";
import TextAutomationDialog from "../components/TextAutomationDialog";
import "../platform-management.css";

const musicAutomationCards = new Map<string, React.ComponentType<{ node: WorkflowNodeDefinition; accounts: PlatformAccount[] }>>([
  ["yourmusic", PuleBrowserGeneration],
]);
const sunoChinaNode: WorkflowNodeDefinition = {
  id: "music:suno_cn", label: names.suno_cn, kind: "music", available: true,
};

function PublicationPlatformCard({ node, platform, accounts, configuration }: {
  node: WorkflowNodeDefinition;
  platform: PlatformTarget;
  accounts: PlatformAccount[];
  configuration?: PlatformConfiguration;
}) {
  const { call, go, notify, refresh } = useStudio();
  const [saving, setSaving] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [error, setError] = useState("");
  const accountId = configuration?.accountId ?? "";
  const defaultAccount = accounts.find(account => account.id === accountId);
  const openingAccount = defaultAccount ?? (!accountId && accounts.length === 1 ? accounts[0] : undefined);
  const page = usePlatformPage(platform, openingAccount, accountId || accounts.length ? "请先选择可用的默认发布账号。" : undefined);
  const accountProvider = defaultAccount?.provider ?? accounts[0]?.provider ?? platform;
  const title = node.label;
  const titleId = "platform-management-" + platform;
  const supportedStatus = publicationWorkflowHandler(platform) === "qishui"
    ? "支持计划工作流发布" : "支持工作流发布";

  const saveDefault = async (next: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await call("platformConfig.setAccount", {
        target: platform,
        accountId: next || null,
        expectedRevision: configuration?.revision ?? 0,
      });
      notify("默认发布账号已保存");
    } catch (cause) {
      if ((cause as { code?: string } | null)?.code === "REVISION_CONFLICT") {
        await refresh().catch(() => undefined);
        setError("默认账号已更新，请重新选择。");
      } else {
        setError("默认账号保存失败，请重试。");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel platform-management-card" aria-labelledby={titleId}>
      <PlatformCardHeader id={titleId} title={title} page={page} openDisabled={saving}
        status={node.available ? supportedStatus : node.reason ?? "暂不支持工作流发布"}>
        <button type="button" className="primary" aria-haspopup="dialog" disabled={saving}
          onClick={() => setDebugging(true)}>执行</button>
      </PlatformCardHeader>
      <label>默认发布账号
        <select aria-label={title + "默认发布账号"} value={accountId}
          disabled={saving || (!accounts.length && !accountId)} onChange={event => void saveDefault(event.target.value)}>
          <option value="">{accounts.length ? "未设置" : "暂无账号"}</option>
          {accountId && !defaultAccount && <option value={accountId} disabled>原默认账号不可用</option>}
          {accounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.name}{account.provider !== platform ? " · " + names[account.provider] : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="row actions">
        <button type="button" onClick={() => go("platform-accounts", accountProvider)}>管理账号</button>
      </div>
      {error && <p role="alert" className="notice">{error}</p>}
      {debugging && <PublicationAutomationDialog node={node} platform={platform} accounts={accounts}
        defaultAccountId={configuration?.accountId} onClose={() => setDebugging(false)} />}
    </article>
  );
}

function ProviderCard({ node, accounts = [], profiles = [], defaultProfileId }: {
  node: WorkflowNodeDefinition;
  accounts?: PlatformAccount[];
  profiles?: ApiProfile[];
  defaultProfileId?: string | null;
}) {
  const { data, runtime, go } = useStudio();
  const [accountId, setAccountId] = useState("");
  const [debugging, setDebugging] = useState(false);
  const [executionNote, setExecutionNote] = useState("");
  const provider = node.id.slice(node.kind.length + 1);
  const account = accounts.find(item => item.id === accountId) ?? (accounts.length === 1 ? accounts[0] : undefined);
  const page = usePlatformPage(provider, account, accounts.length > 1 ? "请选择要核对的账号。" : undefined);
  const text = node.kind === "text";
  const supportedStatus = text ? "支持工作流调用" : "支持工作流生成";
  const supported = node.available && text && Object.hasOwn(textProviderBaseUrls, provider);
  const execute = () => {
    if (supported && data.mode === "production" && !runtime.offlineAcceptance) {
      setDebugging(true);
      return;
    }
    setExecutionNote(supported ? "请在真实本地库执行模型测试。" : "自动化暂未接入");
  };
  const titleId = "platform-management-" + node.id;
  return (
    <article className="panel platform-management-card" aria-labelledby={titleId}>
      <PlatformCardHeader id={titleId} title={node.label} page={page}
        status={node.available ? supportedStatus : node.reason ?? "暂未接入"}>
        <button type="button" className="primary" aria-haspopup={supported ? "dialog" : undefined} onClick={execute}>执行</button>
      </PlatformCardHeader>
      {!text && (accounts.length > 0 || provider === "suno") && <>
        {!!accounts.length && <label>{node.label} 账号
          <select aria-label={node.label + " 账号"} value={account?.id ?? ""} disabled={page.opening}
            onChange={event => setAccountId(event.target.value)}>
            <option value="">选择账号</option>
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <div className="row actions">
          <button type="button" onClick={() => go("platform-accounts", provider)}>管理账号</button>
        </div>
      </>}
      {executionNote && <small className="muted" role="status">{executionNote}</small>}
      {debugging && <TextAutomationDialog title={node.label} defaultProfileId={defaultProfileId}
        profiles={profiles.filter(profile => profile.kind === "text" && profile.providerId === provider)}
        onClose={() => setDebugging(false)} />}
    </article>
  );
}

function ImageProviderCard({ provider }: { provider: ImageApiProvider }) {
  const page = usePlatformPage(provider.id);
  const titleId = `platform-management-${provider.id}`;
  const [open, setOpen] = useState(false);
  return <article className="panel platform-management-card" aria-labelledby={titleId}>
    <PlatformCardHeader id={titleId} title={provider.name} page={page}>
      <button type="button" className="primary" aria-haspopup="dialog" onClick={() => setOpen(true)}>账号信息</button>
    </PlatformCardHeader>
    <ul className="platform-model-options" aria-label="图像型号">
      {imageApiModels(provider.id).map(model => <li key={model.id}>{model.label}</li>)}
    </ul>
    {open && <ImageGenerationDialog provider={provider} onClose={() => setOpen(false)} />}
  </article>;
}

export default function PlatformManagement() {
  const { data } = useStudio();
  const [settings, setSettings] = useState<"text" | "image">();
  const accounts: PlatformAccount[] = data.accounts ?? [];
  const configurations: PlatformConfiguration[] = data.platformConfigurations ?? [];
  const nodes: readonly WorkflowNodeDefinition[] = data.platformWorkflow?.nodes ?? workflowNodesCatalog;
  const textNodes = nodes.filter(node => node.kind === "text");
  const profiles: ApiProfile[] = data.platformWorkflow?.profiles ?? [];
  const defaults = data.platformWorkflow?.defaults;
  const textDefault = profiles.find(profile => profile.kind === "text" && profile.id === defaults?.text);
  const imageDefault = profiles.find(profile => profile.kind === "image" && profile.id === defaults?.image);

  return (
    <div className="platform-management">
      <PageHead title="平台管理" />
      <section aria-labelledby="publication-platforms-title">
        <h2 id="publication-platforms-title">发布平台</h2>
        <div className="platform-management-grid">
          {nodes.filter(node => node.kind === "publish").map(node => {
            const target = PlatformTargetSchema.safeParse(node.id.slice("publish:".length));
            if (!target.success) return null;
            const platform = target.data;
            return <PublicationPlatformCard key={node.id} node={node} platform={platform}
              accounts={accounts.filter(account => accountSupportsTarget(account.provider, platform))}
              configuration={configurations.find(config => config.target === platform)} />;
          })}
        </div>
      </section>
      <section aria-labelledby="music-platforms-title">
        <h2 id="music-platforms-title">歌曲生成</h2>
        <div className="platform-management-grid">
          {nodes.filter(node => node.kind === "music" && node.id !== sunoChinaNode.id).map(node => {
            const provider = node.id.slice("music:".length);
            const Card = musicAutomationCards.get(provider) ?? ProviderCard;
            return <Card key={node.id} node={node} accounts={accounts.filter(account => account.provider === provider)} />;
          })}
          <PuleBrowserGeneration node={sunoChinaNode} accounts={accounts.filter(account => account.provider === "suno_cn")} provider="suno_cn" />
        </div>
      </section>
      <section aria-labelledby="text-platforms-title">
        <div className="section-title platform-management-section-title">
          <div><h2 id="text-platforms-title">文本模型</h2>
            {textDefault && <small className="muted">默认 · {textDefault.label}{textDefault.modelId && ` · ${textDefault.modelId}`}</small>}
          </div>
          {textNodes.some(node => node.available) &&
            <button type="button" aria-haspopup="dialog" onClick={() => setSettings("text")}>配置模型 API</button>}
        </div>
        <div className="platform-management-grid">
          {textNodes.map(node => <ProviderCard key={node.id} node={node} profiles={profiles}
            defaultProfileId={defaults?.text} />)}
        </div>
      </section>
      <section aria-labelledby="image-platforms-title">
        <div className="section-title platform-management-section-title">
          <div><h2 id="image-platforms-title">图像模型</h2>
            {imageDefault && <small className="muted">默认 · {imageDefault.label}{imageDefault.modelId && ` · ${imageDefault.modelId}`}</small>}
          </div>
          <button type="button" aria-haspopup="dialog" onClick={() => setSettings("image")}>配置图像模型</button>
        </div>
        <div className="platform-management-grid">
          {imageApiProviders.map(provider => <ImageProviderCard key={provider.id} provider={provider} />)}
        </div>
      </section>
      {settings && <PlatformAutomationPanel title={settings === "text" ? "配置文本模型" : "配置图像模型"}
        className="platform-model-settings" onClose={() => setSettings(undefined)}>
        <ApiSettings key={settings} scope={settings} />
      </PlatformAutomationPanel>}
    </div>
  );
}
