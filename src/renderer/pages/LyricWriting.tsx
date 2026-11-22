import React, { useEffect, useRef, useState } from "react";
import { apiProviders, type ApiProfile, type CredentialStatus } from "../../shared/api-profiles";
import { artistSongType } from "../../shared/local-artist";
import { bestLyricVersion, canResumeLyricResponse, defaultLyricTargetScore, lyricResultVersion, lyricRewriteLimit, LyricScoreSchema,
  lyricCurrentVersion, meetsLyricTarget, type LyricJob, type LyricJobSummary, type LyricVersion } from "../../shared/lyric-writing";
import { accountSupportsTarget, type PlatformAccount } from "../../shared/platform-accounts";
import { publicationPlatforms, type PlatformTarget } from "../../shared/platform-config";
import type { PromptSummary } from "../../shared/prompt-library";
import { localMusicians, PageHead, useStudio } from "../context";
import ChoiceButtons from "../components/ChoiceButtons";
import HelpHint from "../components/HelpHint";
import LyricInspirationArtist from "../components/LyricInspirationArtist";
import LyricReviewNotes from "../components/LyricReviewNotes";
import { planExecutionMessage } from "../plan-execution-labels";
import type { LocalArtist } from "../components/LocalArtistCreator";

const states: Record<LyricJob["state"], string> = {
  ready: "等待执行", dispatching: "处理中", complete: "已完成", rejected: "未达标",
  stopped: "已停止", blocked: "需处理", unknown: "结果待核对",
};
const stateText = ({ kind, state }: Pick<LyricJob, "kind" | "state">) =>
  kind === "inspiration" && state === "rejected" ? "已完成" : states[state];
const phases: Record<LyricJob["phase"], string> = {
  generate: "生成歌词与风格", score: "独立评分", rewrite: "按反馈改写", prompt: "优化提示词",
};
const errors: Record<string, string> = {
  CREDENTIAL_REQUIRED: "请到配置中心保存所选文本 API 的 Key。",
  SECURE_STORAGE_UNAVAILABLE: "无法读取安全存储中的 API Key。",
  TEXT_PROFILE_REVISION_CHANGED: "文本模型配置已更新，请重新选择配置并开始作词。",
  LYRIC_DEFAULT_PROFILE_CHANGED: "配置中心的默认文本 API 已变化，请核对模型和预算后重新开始。",
  LYRIC_MUSICIAN_SONG_TYPE_CHANGED: "所选艺人的创作类型已更新，请重新确认后开始。",
  LYRIC_ARTIST_CHANGED: "所选艺人资料已更新，请核对资料后重新确认。",
  ARTIST_ACCOUNT_MISMATCH: "艺人已不在所选账号下，请重新选择。",
  ACCOUNT_PROVIDER_MISMATCH: "账号已不适用于所选发布平台，请重新选择。",
  REVISION_CONFLICT: "文本模型配置已更新，请重新选择配置并开始作词。",
  TEXT_PROFILE_OR_PRICE_REQUIRED: "请配置文本模型和计价信息。",
  TEXT_CONFIGURATION_UNAVAILABLE: "文本配置无法使用，请核对模型、计价和 API Key。",
  TEXT_BUDGET_INSUFFICIENT: "剩余预算不足以发起下一轮。",
  TEXT_ACTUAL_COST_EXCEEDED_BUDGET: "回传用量超过任务上限，已停止继续调用。",
  TEXT_COST_RANGE: "回传用量无法按当前计价计算，请核对平台账单和本机计价。",
  TEXT_OUTCOME_UNKNOWN: "本轮执行结果待核对，已停止后续调用。",
  TEXT_USAGE_UNKNOWN: "模型没有返回可核对的用量，已停止后续调用。",
  TEXT_MODEL_UNVERIFIED: "模型响应与所选配置不一致，请核对返回模型 ID。",
  LYRIC_INPUT_TOO_LARGE: "创作输入过长，请缩短灵感或提示词。",
  LYRIC_RESULT_INVALID: "模型返回的内容格式不完整，请核对配置后重新作词。",
  LYRIC_REVIEW_INVALID: "模型返回的评分格式不完整，已停止改写。",
  TEXT_PROCESS_INTERRUPTED: "上次调用被中断，支出与结果待核对。",
  RESTORED_REQUIRES_REVIEW: "任务已从备份恢复，请核对原调用记录。",
  NOT_FOUND: "所选账号、艺人、提示词或任务已删除，请重新选择。",
};
const reasonText = (code: string, inspirationMode = false) => {
  if (inspirationMode && code === "LYRIC_INPUT_TOO_LARGE") return "创作资料过长，请缩短艺人的提示词模板。";
  if (inspirationMode && code === "LYRIC_RESULT_INVALID") return "模型返回的灵感格式不完整，请核对文本 API 后重试。";
  if (inspirationMode && code === "LYRIC_REVIEW_INVALID") return "模型返回的灵感评分格式不完整。";
  return errors[code] ?? (canResumeLyricResponse(code) || code === "TEXT_CONTENT_FILTERED" || code === "TEXT_HTTP_RESPONSE_INVALID"
    ? planExecutionMessage(code) : "操作未完成，请核对任务状态和文本 API 配置。");
};
const active = (job: LyricJob) => job.state === "ready" || job.state === "dispatching";
const money = (micros: number, currency: string) => `${String(micros / 1_000_000)} ${currency}`;

export default function LyricWriting({ onTransfer }: { onTransfer: (draft: Pick<LyricVersion, "title" | "alternateTitle" | "style" | "lyrics">) => void }) {
  const { data, call, go, notify, refresh, exportArtifact } = useStudio();
  const artists: LocalArtist[] = localMusicians(data);
  const [mode, setMode] = useState<"inspiration" | "musician">("inspiration");
  const [inspirationScope, setInspirationScope] = useState({ platform: "" as PlatformTarget | "", accountId: "", artistId: "" });
  const [artistId, setArtistId] = useState("");
  const [profileChoice, setProfileChoice] = useState("default");
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ApiProfile[] | null>(null);
  const [configRefresh, setConfigRefresh] = useState(0);
  const [credential, setCredential] = useState<(CredentialStatus & { profileRevision: number }) | null>(null);
  const [templates, setTemplates] = useState<PromptSummary[]>([]);
  const [history, setHistory] = useState<LyricJobSummary[]>([]);
  const [job, setJob] = useState<LyricJob | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [rewrites, setRewrites] = useState(lyricRewriteLimit);
  const [targetScoreValue, setTargetScoreValue] = useState(String(defaultLyricTargetScore));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const followDefault = profileChoice === "default";
  const profileId = followDefault ? defaultProfileId : profileChoice;
  const profile = profiles?.find(item => item.id === profileId);
  const defaultProfile = profiles?.find(item => item.id === defaultProfileId);
  const supported = profile?.providerId === "deepseek" || profile?.providerId === "doubao";
  const profileRevision = profile?.revision;
  const credentialProfileId = supported && profile?.modelId && profile.textPricing ? profile.id : undefined;
  const currentCredential = credential?.profileId === credentialProfileId && credential?.profileRevision === profileRevision ? credential : null;
  const apiReady = currentCredential?.configured === true;
  const providerName = apiProviders.find(item => item.id === profile?.providerId)?.name;
  const apiStatus = !profiles ? "正在读取模型 API 配置…"
    : !profile ? (followDefault ? "请在模型 API 中设置默认歌词与提示词配置，或在这里选择一项。" : "这项配置已不可用，请重新选择。")
    : !supported ? "AI作词支持模型 API 中的 DeepSeek 和豆包。"
    : !profile.modelId ? "这项配置缺少模型 ID。"
    : !profile.textPricing ? "这项配置缺少模型计价。"
    : !currentCredential ? "正在检查 API Key…"
    : currentCredential.state === "unavailable" ? "无法读取这项配置的 API Key。"
    : !apiReady ? "请在模型 API 中为这项配置保存 API Key。"
    : `${providerName} · ${profile.modelId} · Key 已保存`;
  const inspirationMode = mode === "inspiration";
  const { platform, accountId, artistId: inspirationArtistId } = inspirationScope;
  const accounts: PlatformAccount[] = (data.accounts ?? []).filter((account: PlatformAccount) => platform && accountSupportsTarget(account.provider, platform));
  const account = accounts.find(item => item.id === accountId);
  const roster = account ? artists.filter(item => item.accountId === account.id) : [];
  const artist = inspirationMode ? roster.find(item => item.id === inspirationArtistId) : artists.find(item => item.id === artistId);
  const songType = artistSongType(artist?.defaults);
  const instrumental = songType === "instrumental";
  const configureLyricScore = !inspirationMode && !!artist && !instrumental;
  const targetScore = targetScoreValue === "" ? NaN : Number(targetScoreValue);
  const linkedTemplate = templates.find(item => item.id === artist?.promptTemplateId);
  const production = data.mode === "production";
  const runningId = job && active(job) ? job.id : null;
  const canStart = !!artist && (!inspirationMode || !!account) && !!profile && apiReady && consent && !busy && !runningId &&
    (!configureLyricScore || LyricScoreSchema.safeParse(targetScore).success);
  const changeScope = (scope: typeof inspirationScope) => {
    setInspirationScope(scope);
    setConsent(false);
    setError("");
  };

  useEffect(() => {
    if (!production) return;
    let mounted = true;
    void Promise.all([call("apiProfile.list"), call("generationConfig.read"), call("promptLibrary.list"), call("lyricWriting.list")])
      .then(([allProfiles, defaults, allTemplates, jobs]) => {
        if (!mounted) return;
        setProfiles((allProfiles as ApiProfile[]).filter(p => p.kind === "text"));
        setDefaultProfileId(defaults.roles.text);
        setTemplates(allTemplates);
        setHistory(jobs);
      }).catch(() => { if (mounted) setError("读取作词配置失败，请重新打开本页。"); });
    return () => { mounted = false; };
  }, [call, production, configRefresh]);

  useEffect(() => {
    if (!production) return;
    const refreshConfig = () => setConfigRefresh(count => count + 1);
    window.addEventListener("focus", refreshConfig);
    return () => window.removeEventListener("focus", refreshConfig);
  }, [production]);

  useEffect(() => {
    setConsent(false);
  }, [profileId, profileRevision, artist?.id, artist?.revision]);

  useEffect(() => {
    if (!production || !credentialProfileId || !profileRevision) return;
    let mounted = true;
    setCredential(null);
    const unavailable = () => {
      if (mounted) setCredential({ profileId: credentialProfileId, profileRevision, configured: false, state: "unavailable" });
    };
    void window.rainfall.apiCredentialStatus({ profileId: credentialProfileId }).then(result => {
      if (!mounted) return;
      if (result.ok) setCredential({ ...result.value, profileRevision });
      else unavailable();
    }).catch(unavailable);
    return () => { mounted = false; };
  }, [production, credentialProfileId, profileRevision, configRefresh]);

  useEffect(() => {
    if (!runningId) return;
    let mounted = true;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const next: LyricJob = await call("lyricWriting.read", { id: runningId });
        if (!mounted) return;
        setJob(current => current?.id === runningId ? next : current);
        if (!active(next)) setHistory(previous => previous.map(item => item.id === next.id
          ? { ...item, state: next.state, phase: next.phase, title: next.inspirationResult?.title ?? bestLyricVersion(next.versions)?.title ?? null } : item));
      } catch {
        if (mounted) setError("暂时无法刷新任务状态。");
      } finally {
        reading = false;
      }
    };
    const timer = setInterval(() => void refresh(), 1800);
    return () => { mounted = false; clearInterval(timer); };
  }, [call, runningId]);

  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      setError(reasonText(code ?? "", showProgress ? job?.kind === "inspiration" : inspirationMode));
      if (code === "LYRIC_DEFAULT_PROFILE_CHANGED" || code === "TEXT_PROFILE_REVISION_CHANGED") {
        setConsent(false);
        setConfigRefresh(count => count + 1);
      }
      if (code === "LYRIC_MUSICIAN_SONG_TYPE_CHANGED" || code === "LYRIC_ARTIST_CHANGED" ||
          code === "ARTIST_ACCOUNT_MISMATCH" || code === "ACCOUNT_PROVIDER_MISMATCH" || code === "NOT_FOUND") {
        setConsent(false);
        await refresh().catch(() => {});
      }
    } finally { inFlight.current = false; setBusy(false); }
  };
  const open = (id: string) => perform(async () => {
    setJob(await call("lyricWriting.read", { id }));
    setShowProgress(true);
  });
  const start = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canStart || !profile || !artist) return;
    void perform(async () => {
      const config = { id: crypto.randomUUID(), profileId: profile.id, profileRevision: profile.revision, followDefault, consent: true };
      const result = inspirationMode
        ? await call("lyricWriting.startInspiration", { ...config, platform, accountId, artistId: artist.id, artistRevision: artist.revision })
        : await call("lyricWriting.start", {
          ...config, mode, inspiration: "", artistId: artist.id, expectedSongType: songType, maxRewrites: instrumental ? 0 : rewrites,
          ...(configureLyricScore ? { targetScore } : {}),
        });
      setJob(result);
      setConsent(false);
      setShowProgress(true);
      setHistory(await call("lyricWriting.list"));
    });
  };

  const currentVersion = job && lyricCurrentVersion(job);
  const version = job && lyricResultVersion(job);
  const inspirationJob = job?.kind === "inspiration";
  const inspirationResult = job?.inspirationResult;
  const lyrics = version?.lyrics;
  const instrumentalJob = job?.songType === "instrumental";
  const currentPhase = job && (instrumentalJob ? "生成歌名与风格" : phases[job.phase]);
  const finished = job?.state === "complete" || job?.state === "rejected";
  const scoredResult = job?.state === "complete" && job.targetScore !== undefined && version?.review
    ? { ...version.review, targetScore: job.targetScore, passed: meetsLyricTarget(version.review, job.targetScore) }
    : null;
  const stop = (id: string) => void perform(async () => { setJob(await call("lyricWriting.stop", { id })); });
  const copy = (value: string) => {
    if (!navigator.clipboard) {
      setError("无法访问剪贴板，请手动选中文本复制。");
      return;
    }
    void navigator.clipboard.writeText(value).then(() => notify("已复制"))
      .catch(() => setError("无法访问剪贴板，请手动选中文本复制。"));
  };

  return (
    <>
      <PageHead title={!showProgress ? "AI作词" : inspirationJob ? (runningId ? "灵感生成进度" : "灵感结果") : "AI 作词进度"} action={showProgress && <div className="button-row">
        <button type="button" onClick={() => setShowProgress(false)}>返回 AI作词</button>
        {finished && version && <button type="button" className="primary" onClick={() => onTransfer({
          title: version.title, alternateTitle: version.alternateTitle, style: version.style, lyrics: version.lyrics,
        })}>快速生成</button>}
      </div>} />
      {error && <p className="notice" role="alert">{error}</p>}
      {!showProgress && (!production ? <section className="panel"><p>切换到真实本地库后可使用文本 API 作词。</p></section> : (
        <section className="panel">
          <form onSubmit={start}>
            <ChoiceButtons label="作词方式" value={mode} onChange={value => { setMode(value as typeof mode); setConsent(false); }}
              choices={[{ value: "inspiration", label: "灵感模式" }, { value: "musician", label: "按艺人信息" }]} />
            {inspirationMode ? <>
              <div className="lyric-inspiration-selects">
                <label>发布平台<select aria-label="发布平台" value={platform} required onChange={event => {
                  changeScope({ platform: event.target.value as PlatformTarget | "", accountId: "", artistId: "" });
                }}>
                  <option value="">选择发布平台</option>
                  {publicationPlatforms.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select></label>
                <label>发布账号<select aria-label="发布账号" value={account?.id ?? ""} required disabled={!accounts.length}
                  onChange={event => changeScope({ platform, accountId: event.target.value, artistId: "" })}>
                  <option value="">{!platform ? "先选择发布平台" : accounts.length ? "选择发布账号" : "暂无账号"}</option>
                  {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label>艺人信息<select aria-label="艺人信息" value={artist?.id ?? ""} required disabled={!roster.length}
                  onChange={event => changeScope({ platform, accountId, artistId: event.target.value })}>
                  <option value="">{!account ? "先选择发布账号" : roster.length ? "选择艺人" : "该账号暂无艺人"}</option>
                  {roster.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
              </div>
              {platform && (!accounts.length || (account && !roster.length)) && <div className="button-row">
                <button type="button" onClick={() => go("platform-accounts", account?.provider ?? platform)}>打开账号管理</button>
              </div>}
              {artist && <LyricInspirationArtist artist={artist} templateName={linkedTemplate?.name} />}
            </> : <div className="form-grid">
              <label>艺人信息<select aria-label="艺人信息" value={artistId} required onChange={e => { setArtistId(e.target.value); setConsent(false); }}>
                <option value="">{artists.length ? "选择默认歌手" : "请先添加艺人信息"}</option>
                {artists.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select></label>
              {artist && <label>提示词模板<input readOnly value={linkedTemplate?.name ?? "内置作词提示词"} /></label>}
              {artist && <label>创作类型<input readOnly value={instrumental ? "纯音乐" : "带歌词"} /></label>}
            </div>}
            <div className="form-grid">
              <label>配置中心的文本 API<select value={profileChoice} aria-describedby="lyric-text-api-status"
                onChange={e => { setProfileChoice(e.target.value); setConsent(false); }}>
                <option value="default">跟随配置中心默认 · {defaultProfile?.label ?? "未设置"}</option>
                {profileChoice !== "default" && profiles && !profile && <option value={profileChoice} disabled>原配置不可用</option>}
                {profiles?.map(item => <option value={item.id} key={item.id}>{item.label} · {item.modelId ?? "待填模型"}</option>)}
              </select></label>
              {configureLyricScore && <label>目标评分<input type="number" min={0} max={100} step={1} required value={targetScoreValue}
                onChange={event => { setTargetScoreValue(event.target.value); setConsent(false); }} /></label>}
              {!inspirationMode && !instrumental && <label>最多改写次数
                <select value={rewrites} onChange={e => { setRewrites(Number(e.target.value)); setConsent(false); }}>
                  {Array.from({ length: lyricRewriteLimit + 1 }, (_, index) => <option key={index} value={index}>{index}</option>)}
                </select>
              </label>}
            </div>
            <div className="button-row">
              <span id="lyric-text-api-status" className="muted" role="status">{apiStatus}</span>
              <button type="button" onClick={() => go("accounts", "models")}>打开模型 API</button>
            </div>
            {mode === "musician" && !artists.length && <div className="button-row"><button type="button" onClick={() => go("platform-accounts")}>添加艺人信息</button></div>}
            <label className="inline-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              同意发送创作资料，按所选模型计价调用文本 API，最多 {inspirationMode ? 2 : instrumental ? 1 : 2 + rewrites * 2} 次
            </label>
            <div className="button-row">
              <button className="primary" type="submit" disabled={!canStart}>{!inspirationMode && instrumental ? "生成歌名与风格" : "生成并评分"}</button>
              {configureLyricScore && <HelpHint label="评分流程">评分达到目标且语种符合要求时结束。改写次数用完后采用评分最高的稿件。</HelpHint>}
            </div>
          </form>
        </section>
      ))}
      {showProgress && job && inspirationJob && <>
        {(active(job) || job.reason || job.state === "stopped" || !inspirationResult) && <section className="panel">
          {active(job) && <div className="button-row">
            <span role="status">{job.stopRequested ? "正在停止" : job.phase === "score" ? "灵感评分中" : "灵感生成中"}</span>
            <button type="button" disabled={busy || job.stopRequested} onClick={() => stop(job.id)}>停止后续调用</button>
          </div>}
          {job.reason ? <p role="alert">{reasonText(job.reason, true)}</p>
            : !active(job) && <p role="status">{stateText(job)}</p>}
        </section>}
        {!active(job) && inspirationResult && <section className="panel" aria-label="灵感结果">
          <div className="form-grid">
            <label>歌名 1<input readOnly value={inspirationResult.title} /></label>
            <label>歌名 2<input readOnly value={inspirationResult.alternateTitle} /></label>
          </div>
          <label>灵感内容<textarea rows={8} readOnly value={inspirationResult.inspiration} /></label>
        </section>}
      </>}
      {showProgress && job && !inspirationJob && <><section className="panel">
        <div className="section-title"><h2>执行步骤</h2>
          {active(job) && <button type="button" disabled={busy || job.stopRequested} onClick={() => stop(job.id)}>停止后续调用</button>}
        </div>
        <p role="status">{job.stopRequested && active(job) ? "正在停止" : stateText(job)} · {currentPhase}{!instrumentalJob && ` · 改写 ${job.rewrites}/${job.maxRewrites}`}</p>
        <p className="muted">{job.profileLabel} · {job.modelId} · 已用 {money(job.spentMicros, job.currency)}</p>
        {job.reason && <p role="alert">{reasonText(job.reason)}</p>}
        <ol className="lyric-steps">
          <li><strong>读取创作资料</strong><p>{job.musicianName ? `${job.musicianName} · ${job.templateName ?? "内置作词提示词"}` : job.inspiration}</p></li>
          {job.versions.map((item, index) => <li key={item.id}>
            <strong>{instrumentalJob ? "生成两组歌名与风格" : index === 0 ? "生成歌词、风格与两组歌名" : `第 ${item.rewriteNumber ?? index} 轮改写`}</strong>
            {item.creativeSummary && <p>{item.creativeSummary}</p>}
            {!instrumentalJob && <details open={item.id === currentVersion?.id}>
              <summary>{item.review ? `独立评分 · ${item.review.score}/100` : "独立评分 · 等待结果"}</summary>
              {item.review && <><p>{item.review.languageMatches ? "语种符合目标" : "语种或方言待调整"}</p>
                <LyricReviewNotes review={item.review} /></>}
            </details>}
            {item.id !== version?.id && item.lyrics !== undefined && <details>
              <summary>查看该版歌词</summary>
              <textarea aria-label={`第 ${index + 1} 版歌词`} readOnly rows={8} value={item.lyrics} />
            </details>}
          </li>)}
          {active(job) && <li><strong>{currentPhase}</strong><p>{stateText(job)}</p></li>}
        </ol>
      </section>{version && <section className="panel">
        <div className="section-title"><h2>{instrumentalJob ? "纯音乐创作结果" : finished ? "作词结果" : "当前歌词"}</h2>
          {finished && <button type="button" onClick={() => void exportArtifact("lyricResult", { jobId: job.id, versionId: version.id })}>下载 TXT</button>}
        </div>
        {scoredResult && <p role="status">{scoredResult.passed ? "达到目标" : "采用最高分稿"} · {scoredResult.score} 分 · 目标 {scoredResult.targetScore} 分{!scoredResult.languageMatches && " · 语种待核对"}</p>}
        <div className="form-grid"><label>歌名一<input readOnly value={version.title} /></label><label>歌名二<input readOnly value={version.alternateTitle} /></label></div>
        <label>风格描述<textarea readOnly rows={3} value={version.style} /></label>
        {lyrics !== undefined && <label>歌词<textarea readOnly rows={12} value={lyrics} /></label>}
        <div className="button-row">
          {lyrics !== undefined && <button type="button" onClick={() => copy(lyrics)}>复制歌词</button>}
          <button type="button" onClick={() => copy(version.style)}>复制风格</button>
        </div>
        {finished && version.review && (
          <button type="button" disabled={busy || job.spentMicros >= job.budgetMicros} onClick={() => void perform(async () => {
            setJob(await call("lyricWriting.suggest", { id: job.id, requestId: crypto.randomUUID(), consent: true }));
          })}>用剩余预算优化提示词</button>
        )}
        {job.suggestedPrompt && <div>
          <label>优化后的提示词<textarea readOnly rows={9} value={job.suggestedPrompt} /></label>
          <div className="button-row">
            <button type="button" onClick={() => copy(job.suggestedPrompt!)}>复制提示词</button>
            <button type="button" disabled={busy || savedPrompt === job.id + job.suggestedPrompt} onClick={() => void perform(async () => {
              await call("promptLibrary.save", { id: crypto.randomUUID(), name: `${job.templateName ?? version?.title ?? "AI作词"} · 优化版`,
                content: job.suggestedPrompt, expectedRevision: null });
              setSavedPrompt(job.id + job.suggestedPrompt);
              setTemplates(await call("promptLibrary.list"));
              notify("已另存到提示词管理");
            })}>另存到提示词管理</button>
          </div>
        </div>}
      </section>}</>}
      {!showProgress && !!history.length && <section className="panel"><h2>作词记录</h2><ul className="local-artist-list">
        {history.map(item => <li className="row" key={item.id}>
          <span>{item.title || item.musicianName || item.inspiration} · {stateText(item.id === job?.id ? job : item)}</span>
          <button type="button" disabled={busy} onClick={() => void open(item.id)}>查看</button>
        </li>)}
      </ul></section>}
    </>
  );
}
