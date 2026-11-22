import React, { useEffect, useState } from "react";
import { imageApiModels, manualCoverPrices, paidCoverModelId, supportsImageApiModel, type ApiProfile } from "../../shared/api-profiles";
import { artistSongType } from "../../shared/local-artist";
import { accountSupportsTarget, type PlatformAccount } from "../../shared/platform-accounts";
import { PlatformTargetSchema, publicationPlatforms, type PlatformTarget } from "../../shared/platform-config";
import type { WorkflowNodeDefinition } from "../../shared/platform-directory";
import { imageApiProviders, type ImageApiProviderId, type ImageSelection } from "../../shared/platform-image";
import { canRetrySunoCovers, type PuleAudioChoice, type PuleJob } from "../../shared/pule-browser";
import { date, localMusicians, useStudio } from "../context";
import { useImageCredential } from "../image-credential";
import ArtistProfileFields, { ArtistPromptSelect, formatCoverResolution, profileDraft } from "./ArtistProfileFields";
import type { LocalArtist } from "./LocalArtistCreator";
import PlatformAutomationPanel from "./PlatformAutomationPanel";
import PlatformCardHeader, { usePlatformPage } from "./PlatformCardHeader";

const errors: Record<string, string> = {
  SUNO_CN_ACCOUNT_REQUIRED: "请选择苏诺之音账号。",
  SUNO_CN_ARTIST_CHANGED: "艺人的创作类型已更新，请重新选择艺人。",
  SUNO_CN_BROWSER_UNAVAILABLE: "无法打开苏诺之音专属窗口，请检查 Chrome 或 Edge。",
  SUNO_CN_LOGIN_REQUIRED: "请先在苏诺之音的专属窗口登录。",
  SUNO_CN_CONTROL_UNAVAILABLE: "苏诺之音的创作控件未出现，请核对登录和页面状态。",
  SUNO_CN_FORM_VALUE_CHANGED: "官网未保留填写的内容，请核对创作表单。",
  SUNO_CN_TIMBRE_UNAVAILABLE: "找不到艺人配置的自定义声音，请核对音色名称。",
  SUNO_CN_WEIGHT_UNAVAILABLE: "官网未保留设置的音色权重或风格参考度。",
  SUNO_CN_LIST_UNAVAILABLE: "「我的创作」列表未加载完成，请在官网核对。",
  SUNO_CN_EXISTING_GENERATION: "该账号已有歌曲进行中，请等待完成后再开始。",
  SUNO_CN_SUBMIT_UNAVAILABLE: "官网「创作」按钮暂不可操作，请核对表单和弹窗。",
  SUNO_CN_SUBMIT_UNCONFIRMED: "尚未确认本次创作结果，请先在「我的创作」核对。",
  SUNO_CN_LYRICS_CONFIRM_UNAVAILABLE: "未能完成官网歌词确认，请核对创作弹窗。",
  SUNO_CN_FIRST_TITLE_UNCHANGED: "第一首歌名与创作前相同，请核对本次生成的歌曲。",
  SUNO_CN_RESULT_UNCLEAR: "未能确认本次创作的两首歌曲，请到官网核对。",
  SUNO_CN_PROVIDER_REVIEW_REQUIRED: "官网提示积分不足或人声与风格冲突，请到专属窗口核对。",
  SUNO_CN_RENAME_MENU_UNAVAILABLE: "官网未出现「修改歌曲名称」菜单，请核对第二首。",
  SUNO_CN_RENAME_UNCONFIRMED: "未能确认第二首歌名已保存，请到官网核对。",
  SUNO_CN_WAV_MENU_UNAVAILABLE: "官网未出现 WAV 下载菜单，请在专属窗口核对已生成歌曲。",
  SUNO_CN_WAV_PREPARE_FAILED: "官网未完成 WAV 转换，请在「我的创作」核对原歌曲。",
  SUNO_CN_WAV_CONFIRM_UNAVAILABLE: "点击「下载 WAV」失败，请核对官网的下载弹窗。",
  SUNO_CN_WAV_DIALOG_STILL_OPEN: "WAV 已保存，但官网下载窗口仍开着，请核对后续文件。",
  SUNO_CN_WAV_UNAVAILABLE: "官网下载 WAV 超时，请在官网核对歌曲。",
  SUNO_CN_DOWNLOAD_NOT_STARTED: "官网未开始传输 WAV，请在官网核对下载结果。",
  SUNO_CN_PAGE_CHANGED: "苏诺之音已跳转到其他页面，请核对登录状态。",
  PULE_ACCOUNT_REQUIRED: "请选择谱乐 AI 账号。",
  PULE_PUBLICATION_ACCOUNT_REQUIRED: "请重新选择该平台的发布账号。",
  PULE_ARTIST_REQUIRED: "请选择已有艺人，或先在发布账号下配置艺人。",
  PULE_PRODUCTION_REQUIRED: "请切换到真实本地库制作歌曲。",
  PULE_ACCOUNT_BUSY: "该账号已有制作任务在运行。",
  PULE_BROWSER_UNAVAILABLE: "无法打开谱乐 AI 浏览器。请检查 Chrome 或 Edge，及该账号是否仍在使用。",
  PULE_LOGIN_REQUIRED: "该次制作在官网登录检查时中断。请确认专属窗口已登录后重新制作。",
  PULE_SESSION_UNVERIFIED: "官网登录状态待核对。请检查谱乐 AI 专属窗口后重新制作。",
  PULE_LOGIN_TIMEOUT: "等待谱乐 AI 登录超时，请重新点击「开始制作」。",
  PULE_WINDOW_CLOSED: "谱乐 AI 制作页已关闭。",
  PULE_AGREEMENT_REQUIRED: "谱乐 AI 请求确认协议。请打开专属窗口查看。",
  PULE_INSUFFICIENT_CREDITS: "谱乐 AI 积分不足。",
  PULE_AUDIO_SIZE: "请选择 80 MB 以内的音频。",
  PULE_AUDIO_FORMAT: "请选择 MP3、WAV、AAC、OGG 或 M4A 音频。",
  PULE_AUDIO_REQUIRED: "请重新选择翻唱音频。",
  PULE_AUDIO_CHANGED: "音频文件已变化，请重新选择。",
  PULE_TIMBRE_UNAVAILABLE: "找不到艺人配置的音色，或音色未能应用。请检查艺人信息。",
  PULE_CONTROL_UNAVAILABLE: "谱乐 AI 页面控件未出现，请检查官网当前状态。",
  PULE_FORM_VALUE_CHANGED: "谱乐 AI 未保留填写的内容，请查看官网表单。",
  PULE_PROVIDER_FAILED: "谱乐 AI 返回处理失败。",
  PULE_PRICE_UNAVAILABLE: "无法从谱乐 AI 页面确认所需积分。",
  PULE_PRICE_CHANGED: "谱乐 AI 积分报价已变化。",
  PULE_QUOTE_EXPIRED: "这次积分确认已失效，请查看最新任务状态。",
  PULE_CONFIRMATION_EXPIRED: "积分确认已超时。",
  PULE_COVER_RESULT_UNCLEAR: "未能确认版权音频处理结果。",
  PULE_RESULT_BASELINE_UNAVAILABLE: "制作前未能读取第一首歌曲。请查看谱乐 AI 的歌曲列表后重试。",
  PULE_FIRST_TITLE_UNCHANGED: "第一首歌名与制作前相同，请在谱乐 AI 核对本次制作结果。",
  PULE_RESULT_UNCLEAR: "未能确认本次生成的两首歌曲。",
  PULE_RENAME_UNAVAILABLE: "未找到第二首的改名控件，请在谱乐 AI 核对歌名。",
  PULE_RENAME_UNCONFIRMED: "未能确认第二首歌名已保存，请在谱乐 AI 核对歌名。",
  PULE_DOWNLOAD_UNAVAILABLE: "未找到歌曲的 WAV 下载选项。",
  PULE_DOWNLOAD_CONFIRM_UNAVAILABLE: "未能完成「下载文件」弹窗操作，请在谱乐 AI 核对。",
  PULE_DOWNLOAD_RETRIES_EXHAUSTED: "WAV 下载重试 3 次仍失败，请在谱乐 AI 核对歌曲。",
  PULE_DOWNLOAD_NOT_STARTED: "等待谱乐开始下载超时，请在谱乐 AI 核对原歌曲。",
  PULE_WAV_LINK_TIMEOUT: "等待谱乐返回 WAV 下载地址超时，请核对原歌曲。",
  PULE_WAV_LINK_FAILED: "谱乐未能提供 WAV 下载地址，请核对原歌曲。",
  PULE_WAV_LINK_REJECTED: "谱乐拒绝本次 WAV 下载，请核对账号权限。",
  PULE_WAV_IDENTITY_UNCONFIRMED: "无法确认谱乐 WAV 属于原歌曲，请核对官网中的歌名。",
  PULE_WAV_TRANSFER_FAILED: "谱乐 WAV 传输失败，请核对账号窗口的网络连接。",
  PULE_WAV_SIZE: "谱乐 WAV 文件过大，无法在浏览器中接收。",
  PULE_DOWNLOAD_TIMEOUT: "WAV 传输超时，请在谱乐 AI 核对原歌曲。",
  PULE_DOWNLOAD_FAILED: "保存 WAV 失败。",
  PULE_WAV_INVALID: "官网下载的文件不是有效的 WAV。",
  PULE_LYRICS_SAVE_FAILED: "保存歌词 TXT 失败。",
  PULE_COVER_DOWNLOAD_UNAVAILABLE: "未能下载谱乐 AI 的歌曲封面。",
  PULE_COVER_PROFILE_REQUIRED: "请选择已配置的图像渠道和型号。",
  PULE_COVER_PROFILE_CHANGED: "图像配置已更新，请核对所选型号。",
  PULE_COVER_CREDENTIAL_REQUIRED: "请在配置中心保存所选图像渠道的 API Key。",
  IMAGE_PROFILE_REQUIRED: "图像渠道与 API 配置不匹配，请重新选择。",
  IMAGE_MODEL_REQUIRED: "当前渠道不支持所选型号，请重新选择。",
  REVISION_CONFLICT: "图像配置已更新，请重新打开歌曲制作后选择。",
  PULE_COVER_GENERATION_FAILED: "封面生成失败，请检查封面接口配置。",
  PULE_COVER_GENERATION_UNCONFIRMED: "封面接口结果待核对，请查看服务商的生成记录。",
  PULE_COVER_HTTP_400: "封面接口拒绝出图参数（HTTP 400）。",
  PULE_COVER_HTTP_401: "封面接口密钥校验失败（HTTP 401）。",
  PULE_COVER_HTTP_402: "封面接口账户额度不足（HTTP 402）。",
  PULE_COVER_HTTP_403: "封面接口拒绝访问，请检查权限（HTTP 403）。",
  PULE_COVER_HTTP_429: "封面接口请求受限，请检查额度或频率（HTTP 429）。",
  PULE_COVER_INVALID: "封面图片无法转换为 PNG。",
  PULE_COVER_SAVE_FAILED: "保存歌曲封面 PNG 失败。",
  PULE_COVER_RETRY_UNAVAILABLE: "这条记录暂无可补的封面。",
  PULE_COVER_SOURCE_UNAVAILABLE: "找不到原录音或同名歌词，请核对下载目录中的文件。",
  PULE_COVER_ALREADY_EXISTS: "原录音目录已有同名封面，请先核对该文件。",
  PULE_OUTPUT_UNAVAILABLE: "下载目录不可写，请检查配置中心的下载目录。",
  DOWNLOAD_ROOT_REQUIRED: "请先在配置中心的「下载目录」选择文件夹。",
  DOWNLOAD_ROOT_UNAVAILABLE: "下载目录不可用，请在配置中心重新选择。",
  DOWNLOAD_ROOT_CHANGED: "下载目录已变化，请在配置中心重新选择。",
  DOWNLOAD_ROOT_INVALID: "下载目录不可用，请在配置中心重新选择。",
  PULE_JOURNAL_UNAVAILABLE: "任务记录无法保存，请检查数据目录。",
  PULE_BROWSER_INTERRUPTED: "谱乐 AI 页面连接已中断。",
  PULE_STOPPED: "已停止任务。",
  WORKSPACE_CHANGED: "工作区已切换或恢复，请重新准备任务。",
};
const steps: Record<PuleJob["step"], string> = {
  opening: "正在打开谱乐 AI 专属窗口", login: "请在谱乐 AI 窗口登录，登录后继续制作",
  form: "正在填写创作表单", upload: "正在上传翻唱音频",
  processing: "正在处理版权音频", generation: "正在制作歌曲",
  rename: "正在修改第二首歌名", download: "正在等待谱乐发送 WAV", receive: "正在接收 WAV", cover: "正在生成封面",
};
const isActive = (job: PuleJob) => job.status === "running" || job.status === "awaiting_confirmation";
const explanation = (code?: string, platform = "谱乐 AI") => {
  const status = /^PULE_COVER_HTTP_(4\d\d)$/u.exec(code ?? "")?.[1];
  const text = errors[code ?? ""] ?? (status ? "封面接口拒绝请求（HTTP " + status + "）。" : "谱乐 AI 操作失败，请检查账号和表单。");
  return platform === "谱乐 AI" ? text : text.replace(/谱乐(?: AI)?/gu, platform);
};
const zhipuCoverRejections: Record<string, string> = {
  "1261": "智谱拒绝了过长的封面提示词（1261）。",
  "1301": "本次封面请求触发了智谱内容审核（1301）。",
  "1211": "智谱未识别当前配置的封面模型（1211）。",
};

export default function PuleBrowserGeneration({ node, accounts, provider = "yourmusic" }: {
  node: WorkflowNodeDefinition; accounts: PlatformAccount[]; provider?: "yourmusic" | "suno_cn";
}) {
  const { call, data, go, runtime } = useStudio();
  const suno = provider === "suno_cn";
  const api = suno ? "sunoCnBrowser" : "puleBrowser";
  const accountLabel = node.label + " 账号";
  const titleId = "platform-management-" + node.id;
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [publicationPlatform, setPublicationPlatform] = useState<PlatformTarget>();
  const [publicationAccountId, setPublicationAccountId] = useState("");
  const [artistId, setArtistId] = useState("");
  const [mode, setMode] = useState<"custom" | "cover">("custom");
  const [title, setTitle] = useState("");
  const [alternateTitle, setAlternateTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [styleChoice, setStyleChoice] = useState<string>();
  const [instrumentalChoice, setInstrumentalChoice] = useState<boolean>();
  const [audio, setAudio] = useState<PuleAudioChoice | null>(null);
  const [imageProviderChoice, setImageProvider] = useState<ImageApiProviderId>();
  const [imageModelChoice, setImageModel] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [jobs, setJobs] = useState<PuleJob[]>([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState<{ view: "form" | "history"; text: string }>();

  const account = accounts.find(item => item.id === accountId) ?? accounts[0];
  const page = usePlatformPage(provider, account);
  const allAccounts: PlatformAccount[] = data.accounts ?? [];
  const publicationAccounts = publicationPlatform
    ? allAccounts.filter(item => accountSupportsTarget(item.provider, publicationPlatform)) : [];
  const publicationAccount = publicationAccounts.find(item => item.id === publicationAccountId);
  const allArtists: LocalArtist[] = localMusicians(data);
  const artists = publicationPlatform
    ? publicationAccount ? allArtists.filter(item => item.accountId === publicationAccount.id) : []
    : allArtists;
  const artistAccount = (item: LocalArtist) => allAccounts.find(owner => owner.id === item.accountId);
  const defaultArtist = () => (suno && account ? artists.find(item => item.accountId === account.id) : undefined) ?? artists.find(item => {
    const provider = artistAccount(item)?.provider;
    return !!provider && publicationPlatforms.some(({ id }) => accountSupportsTarget(provider, id));
  }) ?? artists[0];
  const artist = artists.find(item => item.id === artistId) ?? (publicationPlatform ? undefined : defaultArtist());
  const songType = artistSongType(artist?.defaults);
  const instrumental = suno ? songType === "instrumental" : instrumentalChoice ?? (songType === "instrumental");
  const style = styleChoice ?? artist?.defaults?.genre ?? "";
  const imageProfiles: ApiProfile[] = data.platformWorkflow?.profiles ?? [];
  const defaultImage = imageProfiles.find(profile => profile.kind === "image" && profile.id === data.platformWorkflow?.defaults?.image);
  const defaultImageProvider = imageApiProviders.find(item => item.id === defaultImage?.providerId);
  const configuredImageProvider = imageApiProviders.find(item => imageProfiles.some(profile => profile.providerId === item.id));
  const imageProvider = imageProviderChoice ?? defaultImageProvider?.id ?? configuredImageProvider?.id ?? imageApiProviders[0].id;
  const imageCredential = useImageCredential(imageProvider);
  const imageProfile = imageCredential.profile;
  const imageModels = imageApiModels(imageProvider);
  const preferredModel = imageProfile?.modelId;
  const imageModel = supportsImageApiModel(imageProvider, imageModelChoice) ? imageModelChoice
    : supportsImageApiModel(imageProvider, preferredModel) ? preferredModel : imageModels[0]?.id;
  const coverImage: ImageSelection | undefined = imageProfile && imageCredential.status?.configured && imageModel
    ? { profileId: imageProfile.id, expectedRevision: imageProfile.revision, providerId: imageProvider, modelId: imageModel } : undefined;
  const coverPrice = paidCoverModelId(imageModel);
  const ready = node.available && data.mode === "production" && !runtime.offlineAcceptance && !!account && !!artist;
  const activeJobs = jobs.filter(isActive);
  const accountBusy = activeJobs.some(job => job.accountId === account?.id);
  const canExecute = ready && !!coverImage && !action && !accountBusy && !page.opening &&
    (mode === "custom" || !!audio && authorized);

  function chooseArtist(id: string) {
    setArtistId(id);
    setStyleChoice(undefined);
    setInstrumentalChoice(undefined);
  }

  useEffect(() => {
    if (data.mode !== "production") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refreshJobs() {
      try {
        const result = await window.rainfall.call(`${api}.status`, {});
        if (!disposed && result.ok) setJobs(result.value);
      } catch {
        // The next poll can recover after the app connection is restored.
      } finally {
        if (!disposed) timer = setTimeout(refreshJobs, 1_200);
      }
    }
    void refreshJobs();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, data.mode]);

  async function perform(view: "form" | "history", run: () => Promise<void>) {
    if (action) return;
    setAction(view);
    setError(undefined);
    try { await run(); }
    catch (reason) {
      setError({ view, text: explanation((reason as { code?: string } | null)?.code, node.label) });
    } finally { setAction(""); }
  }

  const updateJob = (next: PuleJob | null) => {
    if (next) setJobs(previous => [next, ...previous.filter(item => item.id !== next.id)]);
  };
  const pickAudio = () => perform("form", async () => {
    const selected: PuleAudioChoice | null = await call("puleBrowser.chooseAudio");
    if (selected) { setAudio(selected); setAuthorized(false); }
  });
  const start = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canExecute) return;
    void perform("form", async () => {
      const song = {
        requestId: crypto.randomUUID(), accountId: account.id, artistId: artist.id, mode, title,
        coverImage,
        ...(publicationPlatform && publicationAccount
          ? { publication: { platform: publicationPlatform, accountId: publicationAccount.id } } : {}),
        lyrics: instrumental ? "" : lyrics, style, instrumental,
        ...(alternateTitle.trim() ? { alternateTitle } : {}),
        ...(mode === "cover" ? { uploadToken: audio?.token, uploadAuthorized: authorized } : {}),
      };
      const job = await call(`${api}.start`, song);
      updateJob(job);
      if (mode === "cover") { setAudio(null); setAuthorized(false); }
    });
  };

  const accountField = <label>{accountLabel}
    <select aria-label={accountLabel} value={account?.id ?? ""} disabled={!accounts.length || !!action || page.opening}
      onChange={event => setAccountId(event.target.value)}>
      {!accounts.length && <option value="">暂无账号</option>}
      {suno && !!accounts.length && <option value="" disabled>选择账号</option>}
      {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>;
  const manageAccounts = () => go("platform-accounts", provider);
  const openCreation = () => {
    setPanelOpen(true);
    imageCredential.reload();
  };

  return <>
    <article className="panel platform-management-card music-platform-card" aria-labelledby={titleId}
      onClick={event => {
        if (event.target instanceof Element && !event.target.closest("button, label")) openCreation();
      }}>
      <PlatformCardHeader id={titleId} title={node.label} page={page} openDisabled={accountBusy || !!action}
        status={suno ? "官网自动创作" : node.available ? "支持工作流生成" : node.reason ?? "暂未接入"}>
        <button type="button" className="primary" aria-haspopup="dialog" onClick={openCreation}>执行</button>
      </PlatformCardHeader>
      {accountField}
      <div className="row actions">
        <button type="button" onClick={manageAccounts}>管理账号</button>
      </div>
      {activeJobs.length > 0 && <small className="muted" role="status">{activeJobs.length} 个制作任务进行中</small>}
    </article>

    {panelOpen && <PlatformAutomationPanel title={node.label + " · 歌曲制作"} className="pule-browser"
      onClose={() => { setPanelOpen(false); setHistoryOpen(false); }}>
      <form aria-label={node.label + " 自动制作"} onSubmit={start}>
        <div className="pule-browser-fields">
          {accountField}
          <label>发布平台
            <select aria-label="发布平台" value={publicationPlatform ?? ""} disabled={!!action} onChange={event => {
              setPublicationPlatform(PlatformTargetSchema.safeParse(event.target.value).data);
              setPublicationAccountId("");
              chooseArtist("");
            }}>
              <option value="">不指定发布平台</option>
              {publicationPlatforms.map(platform => <option key={platform.id} value={platform.id}>{platform.label}</option>)}
            </select>
          </label>
          {publicationPlatform && <label>发布账号
            <select aria-label="发布账号" value={publicationAccount?.id ?? ""} disabled={!publicationAccounts.length || !!action}
              onChange={event => {
                setPublicationAccountId(event.target.value);
                chooseArtist("");
              }}>
              <option value="">{publicationAccounts.length ? "请选择发布账号" : "暂无该平台账号"}</option>
              {publicationAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
          <label>艺人信息
            <select aria-label="艺人信息" value={artist?.id ?? ""} disabled={!artists.length || !!action}
              onChange={event => chooseArtist(event.target.value)}>
              {(publicationPlatform || !artist) && <option value="">{publicationPlatform && !publicationAccount ? "请先选择发布账号" :
                artists.length ? "请选择艺人" : "请先在账号管理添加艺人信息"}</option>}
              {artists.map(item => {
                const duplicate = artists.some(other => other.id !== item.id && other.name === item.name);
                const label = duplicate ? `${item.name} · ${artistAccount(item)?.name ?? "本地艺人"}` : item.name;
                return <option key={item.id} value={item.id}>{label}</option>;
              })}
            </select>
          </label>
          {artist && <fieldset className="pule-browser-wide pule-browser-fieldset" aria-label="艺人资料">
            <legend>艺人资料</legend>
            <div className="pule-browser-fields">
              <ArtistPromptSelect value={artist.promptTemplateId ?? ""} />
              <label>创作类型<input readOnly value={songType === "instrumental" ? "纯音乐" : "带歌词"} /></label>
              <label>风格<input readOnly value={artist.defaults?.genre ?? ""} /></label>
              <label>封面分辨率<input readOnly value={formatCoverResolution(artist.defaults?.coverResolution)} /></label>
              <ArtistProfileFields value={profileDraft(artist.profile, artist.secondSinger)} />
            </div>
          </fieldset>}
          {!suno && <label>制作方式
            <select aria-label="制作方式" value={mode} disabled={!!action}
              onChange={event => setMode(event.target.value === "cover" ? "cover" : "custom")}>
              <option value="custom">普通生成</option>
              <option value="cover">翻唱</option>
            </select>
          </label>}
          <div className="row actions pule-browser-account">
            <button type="button" onClick={manageAccounts}>管理{accountLabel}</button>
          </div>
          <label>歌名<input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} required /></label>
          <label>B 版歌名（可选）
            <input value={alternateTitle} onChange={event => setAlternateTitle(event.target.value)} maxLength={80} />
          </label>
          <label className="pule-browser-wide">音乐风格
            <textarea value={style} onChange={event => setStyleChoice(event.target.value)} maxLength={1000} required rows={2} />
          </label>
          <label className="pule-browser-wide pule-browser-check">
            <input type="checkbox" checked={instrumental} disabled={suno} onChange={event => setInstrumentalChoice(event.target.checked)} />纯音乐
          </label>
          {!instrumental && <label className="pule-browser-wide">歌词
            <textarea value={lyrics} onChange={event => setLyrics(event.target.value)} maxLength={5000} required rows={6} />
          </label>}
          <fieldset className="pule-browser-wide pule-browser-fieldset">
            <legend>封面图片</legend>
            <div className="pule-browser-fields">
              <label>提供商 / 渠道
                <select aria-label="提供商 / 渠道" value={imageProvider} disabled={!!action} onChange={event => {
                  setImageProvider(event.target.value as ImageApiProviderId);
                  setImageModel("");
                }}>
                  {imageApiProviders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>图像模型
                <select aria-label="图像模型" value={imageModel} disabled={!!action} onChange={event => setImageModel(event.target.value)}>
                  {imageModels.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
              {!imageCredential.disabled && !coverImage && <small className="pule-browser-wide muted" role="status">
                {imageCredential.checking ? "正在读取图像渠道的 Key 状态…" :
                  imageCredential.error ?? errors.PULE_COVER_CREDENTIAL_REQUIRED}
              </small>}
            </div>
          </fieldset>
        </div>
        {mode === "cover" && <div className="pule-browser-upload">
          <div className="row actions">
            <button type="button" disabled={!ready || !!action} onClick={() => void pickAudio()}>选择翻唱音频</button>
            {audio && <span>{audio.name}</span>}
          </div>
          {audio && <label className="pule-browser-check">
            <input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />
            我有权上传此音频
          </label>}
        </div>}
        <div className="row actions pule-browser-footer">
          <div className="pule-browser-footer-buttons">
            <button type="submit" className="primary" disabled={!canExecute}>开始制作</button>
            <button type="button" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>执行记录</button>
            {activeJobs.some(job => job.quote?.kind === "processing") && <small role="status">有制作任务待确认</small>}
          </div>
          <small className="muted">歌曲制作使用{suno ? "苏诺之音" : "谱乐"}积分。{coverPrice
            ? `A、B 两版封面各生成一张，${manualCoverPrices[coverPrice]}。` : "A、B 两版封面按所选接口计费。"}</small>
        </div>
      </form>
      {error?.view === "form" && <p role="alert" className="notice">{error.text}</p>}
    </PlatformAutomationPanel>}

    {panelOpen && historyOpen && <PuleExecutionHistory
      jobs={jobs} platform={node.label} api={api} busy={!!action} actionError={error?.view === "history" ? error.text : undefined}
      onClose={() => setHistoryOpen(false)}
      onConfirm={(id, quoteId) => void perform("history", async () => updateJob(await call("puleBrowser.confirm", { id, quoteId })))}
      onRetryCovers={suno ? id => void perform("history", async () => updateJob(await call("sunoCnBrowser.retryCovers", { id }))) : undefined}
      onStop={id => void perform("history", async () => updateJob(await call(`${api}.stop`, { id })))} />}
  </>;
}

function PuleExecutionHistory({ jobs, platform, api, busy, actionError, onClose, onConfirm, onRetryCovers, onStop }: {
  jobs: PuleJob[];
  platform: string;
  api: "sunoCnBrowser" | "puleBrowser";
  busy: boolean;
  actionError?: string;
  onClose: () => void;
  onConfirm: (id: string, quoteId: string) => void;
  onRetryCovers?: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const [archive, setArchive] = useState<PuleJob[] | "failed">();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    async function readHistory() {
      try {
        const result = await window.rainfall.call(`${api}.history`, {});
        if (current) setArchive(result.ok ? result.value : "failed");
      } catch {
        if (current) setArchive("failed");
      }
    }
    void readHistory();
    return () => { current = false; };
  }, [api, attempt]);

  useEffect(() => {
    setArchive(previous => {
      if (!Array.isArray(previous)) return previous;
      const recentIds = new Set(jobs.map(job => job.id));
      return [...jobs, ...previous.filter(job => !recentIds.has(job.id))];
    });
  }, [jobs]);

  const records = Array.isArray(archive) ? archive : jobs;
  const reviewMessage = (job: PuleJob) => {
    if (job.code === "PULE_COVER_HTTP_400" && job.coverErrorCode) {
      return zhipuCoverRejections[job.coverErrorCode] ?? `封面请求被智谱拒绝（错误码 ${job.coverErrorCode}）。`;
    }
    if (api === "sunoCnBrowser" && job.code === "PULE_BROWSER_INTERRUPTED") {
      if (job.step === "generation") return errors.SUNO_CN_SUBMIT_UNCONFIRMED;
      if (job.step === "download" || job.step === "receive")
        return "歌曲已生成，WAV 下载未完成。请在「我的创作」核对原歌曲。";
    }
    return explanation(job.code, platform);
  };

  return <PlatformAutomationPanel title={platform + " · 执行记录"} className="pule-browser pule-browser-history" onClose={onClose}>
    {actionError && <p className="notice" role="alert">{actionError}</p>}
    {archive === undefined && <p role="status">正在读取执行记录…</p>}
    {archive === "failed" && <div className="row actions">
      <span role="alert">暂时无法读取执行记录。</span>
      <button type="button" onClick={() => { setArchive(undefined); setAttempt(value => value + 1); }}>重新读取</button>
    </div>}
    {records.length === 0 && Array.isArray(archive) && <p className="muted">暂无执行记录</p>}
    {records.length > 0 && <ul className="pule-browser-jobs" aria-label={platform + " 制作任务"}>
      {records.map(job => {
        const retryCovers = onRetryCovers && canRetrySunoCovers(job) ? onRetryCovers : undefined;
        const image = job.coverImage;
        const modelLabel = image && imageApiModels(image.providerId).find(model => model.id === image.modelId)?.label;
        const price = paidCoverModelId(image?.modelId);
        return <li key={job.id}>
          <div className="row actions pule-browser-job-header">
            <strong>{job.title}</strong>
            {job.accountName && <small>{job.accountName}</small>}
            {job.updatedAt && <small><time dateTime={job.updatedAt} title="更新时间">{date(job.updatedAt)}</time></small>}
            <span role="status">
              {job.status === "completed" ? "制作文件已保存" :
                job.status === "needs_review" ? retryCovers ? "封面待补齐" : `请在${platform}核对处理结果` :
                job.status === "awaiting_confirmation" ? "确认处理版权音频" :
                job.status === "running" ? steps[job.step] : explanation(job.code, platform)}
            </span>
            {job.quote?.kind === "processing" && <button type="button" className="primary" disabled={busy}
              onClick={() => onConfirm(job.id, job.quote!.id)}>确认使用 {job.quote.credits} 积分</button>}
            {retryCovers && <button type="button" disabled={busy} onClick={() => retryCovers(job.id)}>补生成封面</button>}
            {isActive(job) && <button type="button" disabled={busy} onClick={() => onStop(job.id)}>停止</button>}
          </div>
          {image && <small className="muted">封面 · {imageApiProviders.find(provider => provider.id === image.providerId)?.name} · {modelLabel ?? image.modelId}</small>}
          {job.status === "needs_review" && <small>{reviewMessage(job)}</small>}
          {retryCovers && <small className="muted">补齐缺失的封面，{price ? manualCoverPrices[price] : "按封面接口计费"}。</small>}
          {job.status === "needs_review" && job.chargeAttempts?.length ? <small>
            {job.chargeAttempts.map(charge => charge.kind === "generation" ? "歌曲制作" :
              charge.credits === undefined ? "版权音频处理" : "版权音频处理 " + charge.credits + " 积分").join(" · ")}
          </small> : null}
          {!isActive(job) && (job.outputDirectories
            ? (["A", "B"] as const).map(version => <small key={version}>{version} 版目录 {job.outputDirectories![version]}</small>)
            : job.outputDirectory && <small>{job.outputDirectory}</small>)}
          {job.files.length > 0 && <ul aria-label="已保存的制作文件">
            {job.files.map(file => <React.Fragment key={file.version}>
              <li title={file.path}>{file.name}</li>
              {file.lyrics && <li title={file.lyrics.path}>{file.lyrics.name}</li>}
              {file.cover && <li title={file.cover.path}>{file.cover.name}</li>}
            </React.Fragment>)}
          </ul>}
        </li>;
      })}
    </ul>}
  </PlatformAutomationPanel>;
}
