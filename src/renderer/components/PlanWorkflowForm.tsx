import React, { useEffect, useRef, useState } from "react";
import { imageApiModels, supportsImageApiModel, type ApiProfile } from "../../shared/api-profiles";
import { defaultFanqieDirectoryPreferences, fanqieDirectoryPreferencesSchema,
  type FanqieDirectoryPreferences } from "../../shared/fanqie-downloads";
import type { GenerationRole } from "../../shared/generation-config";
import { artistSongType, type ArtistProfile, type SecondSinger } from "../../shared/local-artist";
import { defaultLyricTargetScore, lyricRewriteLimit, LyricScoreSchema } from "../../shared/lyric-writing";
import { accountSupportsTarget, type PlatformAccount } from "../../shared/platform-accounts";
import { platformTargets, type PlatformConfiguration, type PlatformTarget } from "../../shared/platform-config";
import { imageApiProviders, imageCredentialProfiles } from "../../shared/platform-image";
import {
  connectedPlanWorkflowGraph, planGenerationCountLimit, PlanGenerationCountSchema, PlanWorkflowGraphSchema,
  type PlanCenterPlan, type PlanCenterPlanInput, type PlanWorkflowGraph, type PlanWorkflowPublicationTarget,
} from "../../shared/plan-center";
import { isLocalPublicationWorkflow, workflowProvider, workflowPublicationPlatforms, workflowSequence } from "../../shared/plan-workflow-graph";
import { browserMusicProvider, browserMusicProviders, withoutWorkflowLyrics, workflowBrowserMusic, workflowLyricFields, type WorkflowBrowserMusic } from "../../shared/plan-workflow-fields";
import { publicationWorkflowHandler, workflowNodesCatalog, type WorkflowNodeDefinition } from "../../shared/platform-directory";
import { fanqieScope } from "../fanqie-accounts";
import { localMusicians, names, useStudio, useStudioRequest } from "../context";
import FanqieBatchFields, { type FanqieBatchDraft } from "./FanqieBatchFields";
import PlanWorkflowCanvas from "./PlanWorkflowCanvas";
import LoadingIndicator from "./LoadingIndicator";

const genderLabels = { female: "女声", male: "男声", other: "其他" };
const modeLabels = { inspiration: "输入灵感", musician: "按艺人信息" };
const defaultSchedule = { kind: "daily", localTime: "09:00" } as const;
const musicInputLabels = { title: "歌名", alternateTitle: "B 版歌名（可选）", style: "音乐风格", lyrics: "歌词" } as const;
type Prompt = { id: string; name: string };
type ProfileIds = Partial<Record<GenerationRole, string | null>>;
type PlatformWorkflowCatalog = { nodes: readonly WorkflowNodeDefinition[]; profiles: ApiProfile[]; defaults: ProfileIds };

const profileLabel = (profile: ApiProfile) => profile.modelId ? `${profile.label} · ${profile.modelId}` : profile.label;

export function planWorkflowLabel(graph?: PlanWorkflowGraph, catalog = workflowNodesCatalog) {
  return workflowSequence(graph ?? connectedPlanWorkflowGraph)
    .map(step => step.map(id => catalog.find(node => node.id === id)?.label ?? id).join(" / ")).join(" → ");
}

function ReadonlyFields({ values }: { values: Record<string, string | undefined | null> }) {
  return <dl className="plan-workflow-fields">
    {Object.entries(values).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "未设置"}</dd></div>)}
  </dl>;
}

function singerFields(profile?: ArtistProfile, secondSinger?: SecondSinger) {
  return {
    ...(secondSinger ? { "A 版歌手": profile?.singer, "B 版歌手": secondSinger.name } : { 歌手: profile?.singer }),
    性别: profile?.gender && genderLabels[profile.gender],
  };
}

function musicianFields(profile?: ArtistProfile, genre?: string, template?: string) {
  return {
    提示词引擎: template, 风格: genre, 默认词作者: profile?.lyricist, 默认曲作者: profile?.composer,
    签约模式: profile?.contractMode === "exclusive" ? "独家签约" : profile?.contractMode === "non_exclusive" ? "非独家签约" : undefined,
    音色: profile?.voicePersona,
  };
}

const lyricOutputs = (instrumental: boolean) => Object.entries(workflowLyricFields).filter(([key]) => !instrumental || key !== "lyrics");

function MusicNodeSettings({ config, accounts, instrumental, upstream, inherited, hasImageProfile, onChange }: {
  config: WorkflowBrowserMusic; accounts: PlatformAccount[]; instrumental: boolean; upstream: string;
  inherited?: Record<string, string | undefined | null>; hasImageProfile: boolean;
  onChange: (value: WorkflowBrowserMusic) => void;
}) {
  const outputs = lyricOutputs(instrumental);
  const inputs = instrumental ? withoutWorkflowLyrics(config.inputs) : config.inputs;
  const accountLabel = browserMusicProviders[config.provider].label + " 账号";
  const image = config.coverImage;
  return <>
    {inherited && <fieldset><legend>艺人资料</legend><ReadonlyFields values={inherited} /></fieldset>}
    <div className="form-grid plan-workflow-models">
    <label>{accountLabel}<select aria-label={accountLabel} value={config.accountId ?? ""} onChange={event =>
      onChange({ ...config, accountId: event.target.value || undefined })}>
      <option value="">{accounts.length ? "选择账号" : "暂无可用账号"}</option>
      {config.accountId && !accounts.some(account => account.id === config.accountId) &&
        <option value={config.accountId} disabled>原账号不可用</option>}
      {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>
    <label>提供商 / 渠道<select aria-label="提供商 / 渠道" value={image?.providerId ?? ""} onChange={event => {
      const provider = imageApiProviders.find(item => item.id === event.target.value);
      onChange({ ...config, coverImage: provider && { providerId: provider.id } });
    }}>
      <option value="">选择图像渠道</option>
      {imageApiProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </select></label>
    <label>图像模型<select aria-label="图像模型" value={image?.modelId ?? ""} disabled={!image} onChange={event => {
      if (image) onChange({ ...config, coverImage: { ...image, modelId: event.target.value || undefined } });
    }}>
      <option value="">选择图像模型</option>
      {imageApiModels(image?.providerId ?? null).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
    </select></label>
    </div>
    {image && !hasImageProfile && <p className="muted" role="status">请在配置中心保存所选图像渠道的 API Key。</p>}
    <p className="muted">{upstream ? `上游节点 · ${upstream}` : "请先连接上游节点。"}</p>
    <div className="form-grid plan-workflow-models">
      {(Object.keys(musicInputLabels) as (keyof typeof musicInputLabels)[]).filter(key => !instrumental || key !== "lyrics").map(key =>
        <label key={key}>{musicInputLabels[key]}<select aria-label={musicInputLabels[key]} disabled={!upstream} value={inputs[key] ?? ""} onChange={event =>
          onChange({ ...config, inputs: { ...config.inputs, [key]: event.target.value || undefined } })}>
          <option value="">{key === "alternateTitle" ? "留空" : "选择上游字段"}</option>
          {outputs.map(([field, label]) => <option key={field} value={field}>{label}</option>)}
        </select></label>)}
    </div>
  </>;
}

export function PlanWorkflowSummary({ plan, profiles, artistName }: {
  plan: PlanCenterPlan; profiles: Pick<ApiProfile, "id" | "label">[]; artistName?: string;
}) {
  const { data } = useStudio();
  const songType = plan.songType === "instrumental" ? "纯音乐" : "带歌词";
  if (!plan.workflow) {
    const source = { dot: "dot 素材", manual: "本地素材", provider: "模型创作", pule_prompt: "谱乐提示词", creation: "创作中心", workflow: "AI作词 → 创作中心" };
    return <ReadonlyFields values={{ 艺人信息: plan.artistSnapshot?.name ?? artistName, 内容渠道: source[plan.material.source],
      ...(plan.songType ? { 歌曲类型: songType } : {}) }} />;
  }
  if (isLocalPublicationWorkflow(plan.workflow.graph)) {
    const batch = plan.workflow.publications?.[0]?.fanqieBatch;
    return <ReadonlyFields values={{
      发布平台: "番茄音乐",
      发布账号: (data.accounts as PlatformAccount[] | undefined)?.find(account => account.id === plan.workflow?.accountId)?.name,
      作品来源: "配置中心的下载目录",
      ...(batch ? { 每批上传上限: String(batch.limit), 是否签约: batch.signContract ? "签署后继续" : "合同生成后继续" } : {}),
    }} />;
  }
  const { platform, mode, inspiration, maxRewrites, targetScore = defaultLyricTargetScore } = plan.workflow;
  const browser = workflowBrowserMusic(plan.workflow);
  const browserInputs = browser && (plan.songType === "instrumental" ? withoutWorkflowLyrics(browser.inputs) : browser.inputs);
  const snapshot = plan.workflowSnapshot;
  const configured = (role: GenerationRole) => {
    const route = plan.routeSnapshot?.[role];
    return [profiles.find(profile => profile.id === route?.profileId)?.label, route?.modelId].filter(Boolean).join(" · ");
  };
  return <>
    <ReadonlyFields values={{
      艺人信息: plan.artistSnapshot?.name ?? artistName, 歌曲类型: songType, 账号: snapshot?.accountName,
      ...(platform ? { 平台: names[platform] } : {}),
      ...(plan.songType !== "instrumental" && snapshot?.artist ? singerFields(snapshot.artist, snapshot.secondSinger) : {}),
    }} />
    <details className="plan-workflow-summary">
      <summary>{planWorkflowLabel(plan.workflow.graph, data.platformWorkflow?.nodes)}</summary>
      <ReadonlyFields values={{
        ...musicianFields(snapshot?.artist, String(plan.artistSnapshot?.defaults.genre ?? ""), snapshot?.template?.name),
        作词模式: modeLabels[mode], ...(mode === "inspiration" ? { 创作灵感: inspiration } : {}),
        文本API: configured("text"), 最多改写次数: plan.songType === "instrumental" ? "无需改写歌词" : String(maxRewrites),
        ...(plan.songType !== "instrumental" ? { 目标评分: `${targetScore} 分` } : {}),
        封面图片配置: plan.outputs.cover ? configured("image") : "关闭",
        ...(browser ? {
          [browserMusicProviders[browser.provider].label + " 账号"]: data.accounts?.find((account: PlatformAccount) => account.id === browser.accountId)?.name,
          ...Object.fromEntries(Object.entries(browserInputs ?? {}).map(([field, output]) =>
            [musicInputLabels[field as keyof typeof musicInputLabels], workflowLyricFields[output]])),
        } : { 音乐生成配置: configured("music") }),
      }} />
    </details>
  </>;
}

function ProfileSelect({ label, value, profiles, fallback, matching, onChange }: {
  label: string; value: string; profiles: ApiProfile[]; fallback?: ApiProfile; matching: boolean; onChange: (id: string) => void;
}) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{matching ? "匹配配置" : "配置中心默认"}{fallback ? ` · ${profileLabel(fallback)}` : ""}</option>
    {value && !profiles.some(profile => profile.id === value) && <option value={value}>原配置不可用</option>}
    {profiles.map(profile => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}
  </select></label>;
}

export default function PlanWorkflowForm({ initial, busy, error, onClose, onSave }: {
  initial?: PlanCenterPlan;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (plan: PlanCenterPlanInput) => void;
}) {
  const { data, go } = useStudio();
  const call = useStudioRequest();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [platform, setPlatform] = useState<PlatformTarget | "">(initial?.workflow?.platform ?? "");
  const [artistId, setArtistId] = useState(initial?.artistId ?? "");
  const [selectedArtistAccountId, setSelectedArtistAccountId] = useState(initial?.workflow?.accountId ?? "");
  const [fallbackAccountId, setFallbackAccountId] = useState(initial?.workflow?.accountId ?? "");
  const [countValue, setCountValue] = useState(String(initial?.count ?? 1));
  const [workflow, setWorkflow] = useState<PlanWorkflowGraph>(() => initial?.workflow
    ? structuredClone(initial.workflow.graph ?? connectedPlanWorkflowGraph) : { nodes: [], edges: [] });
  const [selectedNodeId, setSelectedNode] = useState(isLocalPublicationWorkflow(initial?.workflow?.graph) ? "publish:fanqie" : "");
  const nodeSettings = useRef<HTMLFieldSetElement>(null);
  const [browserDraft, setBrowserDraft] = useState(() => {
    const config = workflowBrowserMusic(initial?.workflow);
    if (!config || !initial?.workflow?.pule || !initial.outputs.cover) return config;
    const image = initial.routeSnapshot?.image;
    const provider = imageApiProviders.find(item => item.id === image?.providerId);
    if (image?.source !== "override" || !image.profileId || !image.modelId || !provider ||
        !supportsImageApiModel(provider.id, image.modelId)) return config;
    return { ...config, coverImage: { providerId: provider.id, modelId: image.modelId, profileId: image.profileId } };
  });
  const [publicationChoices, setPublicationChoices] = useState<Partial<Record<PlatformTarget, PlanWorkflowPublicationTarget>>>(() =>
    Object.fromEntries(initial?.workflow?.publications?.map(target => [target.platform, target]) ?? []));
  const [fanqieBatchDrafts, setFanqieBatchDrafts] = useState<Partial<Record<string, Partial<FanqieBatchDraft>>>>({});
  const [fanqieAccountDefaults, setFanqieAccountDefaults] = useState<{ accountId: string; batch: FanqieDirectoryPreferences }>();
  const [mode, setMode] = useState<"inspiration" | "musician">(initial?.workflow?.mode ?? "musician");
  const [inspiration, setInspiration] = useState(initial?.workflow?.inspiration ?? "");
  const [maxRewrites, setMaxRewrites] = useState(initial?.workflow?.maxRewrites ?? 5);
  const [targetScoreValue, setTargetScoreValue] = useState(String(initial?.workflow?.targetScore ?? defaultLyricTargetScore));
  const [profileOverrides, setProfileOverrides] = useState(() => {
    const routing = initial?.routing;
    const savedOverride = (role: GenerationRole) => routing?.[role].source === "override" ? routing[role].profileId ?? "" : "";
    return { text: savedOverride("text"), image: savedOverride("image"), music: savedOverride("music") };
  });
  const [cover, setCover] = useState(initial?.outputs.cover ?? true);
  const [initialProfiles, setProfiles] = useState<ApiProfile[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [initialDefaults, setDefaults] = useState<ProfileIds>({});
  const [loadError, setLoadError] = useState(false);
  const directory: PlatformWorkflowCatalog | undefined = data.platformWorkflow;
  const hasDirectory = !!directory;

  useEffect(() => {
    let current = true;
    void Promise.allSettled([hasDirectory ? undefined : call("apiProfile.list"), call("promptLibrary.list"),
      hasDirectory ? undefined : call("generationConfig.read")])
      .then(([list, templates, config]) => {
        if (!current) return;
        if (list.status === "fulfilled" && list.value) setProfiles(list.value);
        if (templates.status === "fulfilled") setPrompts(templates.value);
        if (config.status === "fulfilled" && config.value) setDefaults(config.value.roles);
        setLoadError([list, templates, config].some(result => result.status === "rejected"));
      });
    return () => { current = false; };
  }, [call, hasDirectory]);
  useEffect(() => {
    nodeSettings.current?.scrollIntoView({ block: "nearest" });
  }, [selectedNodeId]);

  const accounts: PlatformAccount[] = data.accounts ?? [];
  const catalog = directory?.nodes ?? workflowNodesCatalog;
  const profiles = directory?.profiles ?? initialProfiles;
  const defaults = directory?.defaults ?? initialDefaults;
  const configurations: PlatformConfiguration[] = data.platformConfigurations ?? [];
  const artists = localMusicians(data);
  const localPublication = isLocalPublicationWorkflow(workflow);
  const publicationPlatforms = workflowPublicationPlatforms(workflow).filter((id): id is PlatformTarget => platformTargets.some(target => target === id));
  const titleOf = (id: string) => catalog.find(node => node.id === id)?.label ?? id;
  const publicationAccounts = (platform: PlatformTarget) => accounts.filter(row => accountSupportsTarget(row.provider, platform));
  const defaultAccount = (target: PlatformTarget) => {
    const options = publicationAccounts(target);
    const configured = configurations.find(config => config.target === target)?.accountId;
    return options.find(row => row.id === configured)?.id ?? (options.length === 1 ? options[0].id : "");
  };
  const scopedAccounts = platform ? publicationAccounts(platform) : [];
  const scopedAccount = scopedAccounts.find(row => row.id === fallbackAccountId);
  const availableArtists = platform ? artists.filter(row => scopedAccount && (row.accountId === scopedAccount.id ||
    !row.accountId && row.id === initial?.artistId && initial?.workflow?.platform === platform &&
      initial?.workflow?.accountId === scopedAccount.id)) : artists;
  const selectedArtist = artists.find(row => row.id === artistId);
  const artistAccountChanged = selectedArtist?.accountId && selectedArtist.accountId !== selectedArtistAccountId;
  const artist = artistAccountChanged ? undefined : availableArtists.find(row => row.id === artistId);
  const account = platform ? scopedAccount : accounts.find(row => row.id === (artist?.accountId || fallbackAccountId));
  const publicationTarget = (target: PlatformTarget): PlanWorkflowPublicationTarget => {
    const choice = publicationChoices[target];
    if (localPublication) return choice ?? { platform: target, accountId: (platform === target && scopedAccount?.id) || defaultAccount(target) };
    if (target !== platform) return choice ?? { platform: target, accountId: defaultAccount(target) };
    const accountId = scopedAccount?.id ?? "";
    return choice?.accountId === accountId ? choice : { platform: target, accountId };
  };
  const publications = publicationPlatforms.map(publicationTarget);
  const fanqieTarget = publications.find(target => target.platform === "fanqie");
  const fanqieAccountId = fanqieTarget?.accountId ?? "";
  const savedFanqieBatch = fanqieTarget?.fanqieBatch;
  useEffect(() => {
    if (!fanqieAccountId || savedFanqieBatch) return;
    let current = true;
    const read = async () => {
      let batch = defaultFanqieDirectoryPreferences;
      try {
        const result = await window.rainfall.fanqieUpload("configuration", fanqieScope(fanqieAccountId));
        const saved = fanqieDirectoryPreferencesSchema.safeParse(result.ok ? result.value.configuration?.directoryPreferences : undefined);
        if (saved.success) batch = saved.data;
      } catch {
        // A draft can use the default settings while the account is unavailable.
      }
      if (current) setFanqieAccountDefaults({ accountId: fanqieAccountId, batch });
    };
    void read();
    return () => { current = false; };
  }, [fanqieAccountId, savedFanqieBatch]);
  const accountBatch = fanqieAccountDefaults?.accountId === fanqieAccountId ? fanqieAccountDefaults.batch : undefined;
  const defaultBatch = savedFanqieBatch ?? accountBatch ?? defaultFanqieDirectoryPreferences;
  const fanqieBatchDraft = { limit: String(defaultBatch.limit), signContract: defaultBatch.signContract, ...fanqieBatchDrafts[fanqieAccountId] };
  const fanqieBatch = fanqieDirectoryPreferencesSchema.safeParse({ ...fanqieBatchDraft, limit: Number(fanqieBatchDraft.limit) });
  const publishes = publications.length > 0;
  const template = prompts.find(row => row.id === artist?.promptTemplateId);
  const instrumental = artistSongType(artist?.defaults) === "instrumental";
  const selectedNode = workflow.nodes.includes(selectedNodeId) ? catalog.find(node => node.id === selectedNodeId) : undefined;
  const selectedPublication = publications.find(target => "publish:" + target.platform === selectedNodeId);
  const textProvider = workflowProvider(workflow, "text"), musicProvider = workflowProvider(workflow, "music");
  const browserProvider = browserMusicProvider(musicProvider);
  const browser: WorkflowBrowserMusic | undefined = browserProvider
    ? browserDraft?.provider === browserProvider ? browserDraft : { provider: browserProvider, inputs: {} } : undefined;
  const browserAccounts = accounts.filter(row => row.provider === browserProvider);
  const browserUpstream = workflow.edges.find(link => link.to === "music:" + browserProvider)?.from;
  const imageChoice = browser?.coverImage;
  const coverProfile = imageChoice && imageCredentialProfiles(profiles, imageChoice.providerId, defaults.image).find(profile =>
    !imageChoice.profileId || profile.id === imageChoice.profileId);
  const coverEnabled = !!browser || cover || publishes;
  const inherited = artist && {
    ...musicianFields(artist.profile, artist.defaults?.genre, template?.name),
    创作类型: instrumental ? "纯音乐" : "带歌词",
    封面分辨率: artist.defaults?.coverResolution ? `${artist.defaults.coverResolution} × ${artist.defaults.coverResolution}` : undefined,
    歌手数量: artist.secondSinger ? "2 位" : "1 位",
    ...singerFields(artist.profile, artist.secondSinger),
    ...(artist.profile?.timbreWeight !== undefined ? { 音色权重: String(artist.profile.timbreWeight) } : {}),
    ...(artist.profile?.styleWeight !== undefined ? { 风格权重: String(artist.profile.styleWeight) } : {}),
  };
  const textProfiles = profiles.filter(p => p.kind === "text" && p.modelId && p.textPricing && (!textProvider || p.providerId === textProvider));
  const imageProfiles = profiles.filter(p => p.kind === "image" &&
    (p.providerId === "local_image" || p.providerId === "dot_image" || supportsImageApiModel(p.providerId, p.modelId)));
  const musicProfiles = profiles.filter(p => p.kind === "music" && p.modelId &&
    catalog.some(node => node.id === `music:${p.providerId}` && node.available) && (!musicProvider || p.providerId === musicProvider));
  const defaultFor = (role: GenerationRole, options: ApiProfile[]) => options.find(row => row.id === defaults[role]) ??
    (role !== "image" && workflowProvider(workflow, role) && options.length === 1 ? options[0] : undefined);
  const selected = (role: GenerationRole, options: ApiProfile[]) => profileOverrides[role]
    ? options.find(row => row.id === profileOverrides[role]) : defaultFor(role, options);
  const music = selected("music", musicProfiles);
  const count = Number(countValue);
  const validCount = PlanGenerationCountSchema.safeParse(count).success;
  const targetScore = targetScoreValue === "" ? NaN : Number(targetScoreValue);
  const connectedGraph = PlanWorkflowGraphSchema.safeParse(workflow).success;
  const completeGraph = connectedGraph && workflow.nodes.every(id => catalog.some(node => node.id === id && node.available));
  const completeGeneration = artist && account && validCount &&
    (mode === "musician" || inspiration.trim()) && (instrumental || LyricScoreSchema.safeParse(targetScore).success);
  const valid = !!(title.trim() && completeGraph &&
    fanqieBatch.success && (!fanqieAccountId || savedFanqieBatch || accountBatch) &&
    (localPublication ? publicationAccounts("fanqie").some(row => row.id === fanqieAccountId) : completeGeneration));

  const changeWorkflow = (next: PlanWorkflowGraph) => {
    if (JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges }) !== JSON.stringify({ nodes: next.nodes, edges: next.edges })) {
      setProfileOverrides(previous => ({ ...previous,
        ...(workflowProvider(next, "text") !== textProvider ? { text: "" } : {}),
        ...(workflowProvider(next, "music") !== musicProvider ? { music: "" } : {}),
      }));
      const nextProvider = workflowProvider(next, "music");
      const nextUpstream = next.edges.find(link => link.to === "music:" + nextProvider)?.from;
      const lyricNode = (id: string) => id === "lyrics" || id.startsWith("text:");
      const oldText = workflow.nodes.find(lyricNode), nextText = next.nodes.find(lyricNode);
      if (nextProvider !== musicProvider) setBrowserDraft(undefined);
      else if (nextUpstream !== browserUpstream || oldText !== nextText && !!browserUpstream)
        setBrowserDraft(previous => previous && { ...previous, inputs: {} });
    }
    setWorkflow(next);
    if (!localPublication && isLocalPublicationWorkflow(next)) setSelectedNode("publish:fanqie");
    else if (!next.nodes.includes(selectedNodeId)) setSelectedNode("");
  };

  const renderProfile = (role: GenerationRole, label: string, available: ApiProfile[]) => {
    const fallback = defaultFor(role, available);
    return <ProfileSelect label={label} value={profileOverrides[role]} profiles={available} fallback={fallback}
      matching={!!fallback && fallback.id !== defaults[role]}
      onChange={id => setProfileOverrides({ ...profileOverrides, [role]: id })}
    />;
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy || !fanqieBatch.success) return;
    if (localPublication && fanqieTarget) {
      onSave({
        id: initial?.id ?? crypto.randomUUID(), title: title.trim(), artistId: "", origin: initial?.origin ?? "plan",
        enabled: false, schedule: initial?.schedule ?? defaultSchedule, catchUp: initial?.catchUp,
        workflow: { accountId: fanqieTarget.accountId, platform: "fanqie", graph: workflow,
          publications: [{ ...fanqieTarget, fanqieBatch: fanqieBatch.data }],
          mode: "musician", inspiration: "", maxRewrites: 0 },
        material: { source: "workflow" }, outputs: { lyrics: false, cover: false, music: false },
        text: { consent: false }, music: { route: "manual", consent: false },
      });
      return;
    }
    if (!account) return;
    const route = (profileId: string) => profileId ? { source: "override" as const, profileId } : { source: "default" as const };
    const selection = (role: GenerationRole, profiles: ApiProfile[]) => route(profileOverrides[role] ||
      (defaultFor(role, profiles)?.id === defaults[role] ? "" : defaultFor(role, profiles)?.id ?? ""));
    onSave({
      ...initial,
      id: initial?.id ?? crypto.randomUUID(), title: title.trim(), artistId, origin: initial?.origin ?? "plan", count,
      enabled: false, schedule: initial?.schedule ?? defaultSchedule,
      songType: instrumental ? "instrumental" : "vocal",
      workflow: { accountId: account.id, ...(platform ? { platform } : {}), graph: workflow,
        ...(browser ? { browserMusic: { ...browser,
          ...(imageChoice && { coverImage: { ...imageChoice, profileId: coverProfile?.id ?? imageChoice.profileId } }) } } : {}),
        ...(publishes ? { publications: publications.filter(target => target.accountId).map(target =>
          target.platform === "fanqie" ? { ...target, fanqieBatch: fanqieBatch.data } : target) } : {}),
        mode, inspiration: mode === "inspiration" ? inspiration.trim() : "", maxRewrites, ...(instrumental ? {} : { targetScore }) },
      material: { source: "workflow" }, outputs: { lyrics: !instrumental, cover: coverEnabled, music: true },
      routing: { text: selection("text", textProfiles), image: browser ? route(coverProfile?.id ?? "") : selection("image", imageProfiles),
        music: browser ? { source: "default" } : selection("music", musicProfiles) },
      text: { ...initial?.text, consent: false },
      music: { ...initial?.music, route: browser ? browserMusicProviders[browser.provider].route : "pule",
        profileId: browser ? undefined : music?.id, profileRevision: browser ? undefined : music?.revision,
        modelId: browser ? undefined : music?.modelId ?? undefined,
        consent: false, versionPolicy: initial?.music.versionPolicy ?? "first", creditPolicy: undefined },
      authorization: { text: false, music: false, publish: false },
    });
  };

  return <div className="plan-modal-backdrop">
    <section className="plan-editor plan-workflow-editor scroll-panel" role="dialog" aria-modal="true" aria-labelledby="plan-workflow-title"
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && !busy) onClose(); }}>
      <div className="section-title"><h2 id="plan-workflow-title">{initial ? "编辑计划" : "新建计划"}</h2>
        <button type="button" disabled={busy} onClick={onClose}>关闭</button>
      </div>
      <form className="scroll-panel-body" onSubmit={submit}>
        <div className={`plan-workflow-basics${platform ? " has-platform" : ""}`}>
          <label>名称<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
          {!localPublication && <>
          <label>发布平台
            <select aria-label="发布平台" title="发布步骤以画布连线为准" value={platform} onChange={event => {
            const target = event.target.value as PlatformTarget | "";
            setPlatform(target); setFallbackAccountId(target ? defaultAccount(target) : ""); setArtistId("");
          }}>
            <option value="">未指定</option>
            {platformTargets.filter(target => target === platform || catalog.some(node => node.id === "publish:" + target))
              .map(target => <option key={target} value={target}>{titleOf("publish:" + target)}</option>)}
          </select></label>
          {platform && <label>发布账号<select aria-label="发布账号" required value={fallbackAccountId} onChange={event => {
            setFallbackAccountId(event.target.value); setArtistId("");
          }}>
            <option value="">{scopedAccounts.length ? "选择账号" : "暂无可用账号"}</option>
            {fallbackAccountId && !scopedAccount && <option value={fallbackAccountId} disabled>原账号不可用</option>}
            {scopedAccounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>}
          <label>艺人信息<select aria-label="艺人信息" required disabled={!!platform && !scopedAccount} value={artistId} onChange={event => {
            const id = event.target.value;
            const chosen = availableArtists.find(row => row.id === id);
            setArtistId(id);
            setSelectedArtistAccountId(chosen?.accountId ?? fallbackAccountId);
          }}>
            <option value="">选择艺人</option>
            {availableArtists.map(row => <option key={row.id} value={row.id} disabled={!!artistAccountChanged && row.id === artistId}>{row.name}</option>)}
          </select></label>
          <label>歌曲生成次数<input required type="number" min={1} max={planGenerationCountLimit} step={1} value={countValue}
            aria-invalid={!validCount} aria-describedby={validCount ? undefined : "plan-generation-count-error"}
            onChange={event => setCountValue(event.target.value)} /></label>
          </>}
        </div>
        {!localPublication && <>
        {!platform && artist && !artist.accountId && <label>关联账号<select aria-label="关联账号" required value={fallbackAccountId}
          onChange={event => { setFallbackAccountId(event.target.value); setSelectedArtistAccountId(event.target.value); }}>
          <option value="">选择账号</option>
          {accounts.map(row => <option key={row.id} value={row.id}>{row.name} · {names[row.provider]}</option>)}
        </select></label>}
        {artist && <ReadonlyFields values={{
          ...inherited,
          ...(!platform && artist.accountId && account ? { 账号: account.name } : {}),
        }} />}
        {artistId && !artist && <p className="plan-warning" role="status">{artistAccountChanged
          ? "原艺人已关联到其他账号，请重新选择。" : "原艺人已移除，请重新选择。"}</p>}
        {artist?.accountId && !account && <p className="plan-warning" role="status">找不到艺人关联的账号。</p>}
        {(!artists.length || !accounts.length || artist?.accountId && !account || platform && (!scopedAccounts.length || scopedAccount && !availableArtists.length)) &&
          <button type="button" onClick={() => go("platform-accounts", platform || undefined)}>打开账号管理</button>}
        {mode === "inspiration" && <fieldset>
          <legend>原计划的创作灵感</legend>
          <label>创作灵感<textarea required maxLength={16_000} value={inspiration}
            onChange={event => setInspiration(event.target.value)} /></label>
          <button type="button" onClick={() => setMode("musician")}>改用艺人信息</button>
        </fieldset>}
        </>}
        <PlanWorkflowCanvas value={workflow} catalog={catalog} selectedNode={selectedNodeId} onSelect={setSelectedNode} onChange={changeWorkflow} />
        {selectedNode && <fieldset ref={nodeSettings} className="plan-workflow-node-settings">
          <legend>{selectedNode.label}节点配置</legend>
          {(selectedNode.kind === "lyrics" || selectedNode.kind === "text") && <>
            <ReadonlyFields values={{ 艺人信息: artist?.name, 提示词引擎: template?.name }} />
            <div className="form-grid plan-workflow-models">
              {renderProfile("text", selectedNode.kind === "text" ? `${selectedNode.label} 文本 API` : "文本 API", textProfiles)}
              {!instrumental && <label>目标评分<input type="number" min={0} max={100} step={1} required value={targetScoreValue}
                onChange={event => setTargetScoreValue(event.target.value)} /></label>}
              {!instrumental && <label>最多改写次数<select aria-label="最多改写次数" value={maxRewrites}
                onChange={event => setMaxRewrites(Number(event.target.value))}>
                {Array.from({ length: lyricRewriteLimit + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select></label>}
            </div>
            {!textProfiles.length && <button type="button" onClick={() => go("accounts", "models")}>配置文本 API</button>}
            <div className="plan-workflow-outputs"><span>返回结果</span>
              {lyricOutputs(instrumental).map(([field, label]) => <span className="badge" key={field}>{label}</span>)}
            </div>
          </>}
          {browser && selectedNode.id === "music:" + browser.provider && <>
            <MusicNodeSettings config={browser} accounts={browserAccounts} instrumental={instrumental}
              upstream={browserUpstream ? titleOf(browserUpstream) : ""} inherited={inherited}
              hasImageProfile={!!coverProfile} onChange={setBrowserDraft} />
            {!browserAccounts.length && <button type="button" onClick={() => go("platform-accounts", browser.provider)}>添加账号</button>}
          </>}
          {selectedNode.kind === "music" && !browser &&
            renderProfile("music", `${selectedNode.label} 音乐 API`, musicProfiles)}
          {selectedNode.kind === "creation" && !musicProvider && <>
            {renderProfile("music", "音乐生成配置", musicProfiles)}
            <label className="check"><input type="checkbox" checked={coverEnabled} disabled={publishes}
              onChange={event => setCover(event.target.checked)} />{publishes ? "生成封面（发布所需）" : "生成封面"}</label>
            {coverEnabled && renderProfile("image", "封面图片配置", imageProfiles)}
          </>}
          {selectedPublication && <>
            <label>{selectedNode.label}发布账号<select value={selectedPublication.accountId}
              disabled={!localPublication && selectedPublication.platform === platform} onChange={event => {
                setPublicationChoices({ ...publicationChoices,
                  [selectedPublication.platform]: { platform: selectedPublication.platform, accountId: event.target.value },
                });
              }}>
              <option value="">选择账号</option>
              {selectedPublication.accountId && !publicationAccounts(selectedPublication.platform).some(row => row.id === selectedPublication.accountId) &&
                <option value={selectedPublication.accountId}>原账号不可用</option>}
              {publicationAccounts(selectedPublication.platform).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label>
            {publicationWorkflowHandler(selectedPublication.platform) === "fanqie" && <>
              {localPublication && <p className="muted">作品来源 · 配置中心的下载目录</p>}
              <FanqieBatchFields value={fanqieBatchDraft} valid={fanqieBatch.success}
                disabled={!fanqieAccountId || (!savedFanqieBatch && !accountBatch)} onChange={changes => {
                  setFanqieBatchDrafts(previous => ({ ...previous, [fanqieAccountId]: { ...previous[fanqieAccountId], ...changes } }));
                }} />
            </>}
            {!publicationAccounts(selectedPublication.platform).length &&
              <button type="button" onClick={() => go("platform-accounts", selectedPublication.platform)}>添加发布账号</button>}
          </>}
        </fieldset>}
        {loadError && !localPublication && <p className="plan-warning" role="status">读取模型或提示词引擎失败。</p>}
        {error && <p className="plan-error" role="alert">{error}</p>}
        {!connectedGraph && workflow.nodes.length > 0 && <p className="plan-warning" role="status">
          {publishes ? "发布节点需要上游作品。请连接作词和音乐生成节点，再将音乐输出连到发布节点。" : "请连接作词和音乐生成节点。"}
        </p>}
        {!localPublication && !validCount && <p className="plan-error" id="plan-generation-count-error" role="status">
          歌曲生成次数须为 1 到 {planGenerationCountLimit} 的整数。
        </p>}
        <div className="plan-editor-footer">
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="primary" type="submit" disabled={!valid || busy} aria-busy={busy}>
            {busy ? <LoadingIndicator label="正在保存…" /> : "保存计划"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
