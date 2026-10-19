import HelpNote from "./HelpNote";
import React, { useEffect, useState } from "react";
import { useStudio, SelectArtist, Badge, date } from "../context";
import {
  productionDefaultTimezone,
  productionDefaultLocalTime,
  productionSchedulePreview,
} from "../../shared/production-schedule";
export function ProductionFlowSchedule({
  plan,
  now = new Date(),
}: {
  plan: {
    timezone: string;
    localTime: string | null;
    enabled?: boolean;
    nextDueIso?: string | null;
    schedulePreview?: { nextDueIso?: string | null };
  };
  now?: Date;
}) {
  const schedule = productionSchedulePreview(
    plan,
    now,
    plan.nextDueIso ?? plan.schedulePreview?.nextDueIso,
  );
  return (
    <div aria-label="每日计划时间">
      <p>{schedule.description}</p>
      {schedule.nextDueIso && (
        <p className="muted">
          {plan.enabled ? "下次到期：" : "下次时间预览（当前停用）："}
          <time dateTime={schedule.nextDueIso}>
            {schedule.nextLocalDateTime}（{plan.timezone}）
          </time>
          {" · "}
          <code>{schedule.nextDueIso}</code>
          {schedule.resolvedLocalTime !== plan.localTime &&
            ` · 按时区规则顺延至 ${schedule.resolvedLocalTime}`}
        </p>
      )}
    </div>
  );
}
const labels: Record<string, string> = {
  scheduled: "等待到点",
  queued: "已排队",
  ready: "等待推进",
  waiting: "等待原任务结果",
  dispatching: "原请求处理中",
  awaiting_approval: "待本轮确认",
  candidate_ready: "候选待确认",
  candidate_review: "候选待确认",
  awaiting_candidate_approval: "候选待确认",
  awaiting_candidate: "候选待确认",
  ready_for_review: "候选待确认",
  ready_to_publish: "材料已齐 · 待发布",
  awaiting_publication_approval: "待逐首授权发布",
  needs_music_materials: "等待导入音频和封面",
  needs_materials: "等待补齐素材",
  music_pending: "原音乐任务处理中",
  text_pending: "文本处理中",
  scoring: "模型评分中",
  blocked: "本轮需处理",
  unknown: "结果未知 · 禁止重发",
  complete: "已取得官方回执",
  completed: "已取得官方回执",
  failed: "本轮失败",
  draft: "计划草稿",
  enabled: "日程已启用",
  disabled: "日程已停用",
  CREDENTIAL_REQUIRED: "未保存此配置的 Key；尚未发送请求",
  MUSIC_PRICING_UNVERIFIED: "音乐每次收费上界尚未核验，禁止自动扣费",
  MUSIC_GRANT_REQUIRED: "尚未授权本轮音乐费用，可到作品详情导入原音频",
  MUSIC_AUTHORIZATION_REQUIRED: "尚未授权本轮音乐费用，可到作品详情导入原音频",
  NEEDS_MUSIC_MATERIALS: "等待导入原音频与封面",
  CANDIDATE_REVIEW_REQUIRED: "请确认当前候选版本后继续评分与生产",
  COVER_REQUIRED: "等待导入并选择封面",
  COVER_MISSING: "等待导入并选择封面",
  LYRICS_AUDIO_MATCH_UNCONFIRMED: "请在作品详情试听并确认歌词与音频一致",
  RIGHTS_CONFIRMATION: "请在发布中心确认本首歌的权利和署名",
  PUBLICATION_APPROVAL_REQUIRED: "等待本首歌的账号、录音与协议授权",
  TEXT_BUDGET_INSUFFICIENT: "本轮文本预算不足，尚未发送请求",
  MUSIC_BUDGET_INSUFFICIENT: "本轮音乐额度不足，尚未发送请求",
  TEXT_SCORE_INVALID: "模型评分结构或证据无效，可在上限内重试评分",
  QUALITY_THRESHOLD_NOT_MET: "当前候选未达到所设阈值",
  REVISION_LIMIT: "已达到最多两次改写的范围",
  ACCOUNT_UNIQUE_ID_REQUIRED: "尚无可验证的腾讯账号唯一身份",
  AI_ROUTE_NOT_VALIDATED: "官网 AI 投稿路径的写入控件尚未验证",
  TERMS_ACCEPTANCE_REQUIRED: "新的投稿协议仍需逐首确认",
  PUBLICATION_AUTHORITY_REQUIRED: "尚无本首歌的账号及条款授权",
  PUBLICATION_EXECUTOR_UNAVAILABLE: "真实发布执行器尚不可用",
  BUDGET_INSUFFICIENT: "本轮剩余预算不足以覆盖请求上界",
  PROVIDER_RISK_FROZEN: "此配置存在未知费用或结果，先核对原单",
};
const label = (v: string) => labels[v] ?? v;
export default function ProductionFlowWorkspace() {
  const [formOpen, setFormOpen] = useState(false);
  const { data, go, notify, refresh } = useStudio();
  const [rows, setRows] = useState<any>({ plans: [], runs: [] }),
    [capability, setCapability] = useState<any>(null),
    [profiles, setProfiles] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [context, setContext] = useState<any>(null);
  const [artistId, setArtist] = useState(data.artists[0]?.id ?? ""),
    [title, setTitle] = useState("每日爱情故事候选"),
    [theme, setTheme] = useState(
      "从相识到熟悉，把日常陪伴写成克制而温暖的中文情歌",
    ),
    [timezone, setZone] = useState(productionDefaultTimezone),
    [time, setTime] = useState(productionDefaultLocalTime);
  const [candidateMode, setCandidate] = useState("local_template"),
    [scoreMode, setScore] = useState("rule_based"),
    [profileId, setProfile] = useState(""),
    [budget, setBudget] = useState(""),
    [consent, setConsent] = useState(false),
    [threshold, setThreshold] = useState(75),
    [revisions, setRevisions] = useState(2),
    [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [musicEnabled, setMusicEnabled] = useState(false),
    [musicProfile, setMusicProfile] = useState(""),
    [musicBudget, setMusicBudget] = useState(""),
    [musicMax, setMusicMax] = useState(""),
    [pricingEvidence, setEvidence] = useState(""),
    [musicConsent, setMusicConsent] = useState(false);
  const unwrap = async (
    action: Parameters<typeof window.rainfall.productionFlow>[0],
    input: unknown = {},
  ) => {
    const r = await window.rainfall.productionFlow(action, input);
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  };
  const read = async (id?: string) => {
    const r = await unwrap("list");
    setRows(r);
    const pick = id ?? selected;
    if (pick) setContext(await unwrap("context", { id: pick }));
  };
  useEffect(() => {
    if (data.mode !== "production") return;
    let live = true;
    void (async () => {
      const p = await window.rainfall.call("apiProfile.list");
      if (p.ok && live) setProfiles(p.value);
      const c = await unwrap("capability");
      if (live) setCapability(c);
      await read();
    })().catch((e) => live && setError(e.message));
    const timer = setInterval(() => {
      if (live) void read().catch(() => {});
    }, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [data.mode, selected]);
  if (data.mode !== "production") return null;
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await read();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  };
  const textNeeded = candidateMode === "deepseek" || scoreMode === "deepseek",
    profile = profiles.find((p) => p.id === profileId),
    mp = profiles.find((p) => p.id === musicProfile),
    run = context?.run ?? context,
    candidate = run?.candidate ?? context?.candidate,
    draft = candidate?.draft ?? candidate;
  const selectRun = async (id: string) => {
    setSelected(id);
    await act(async () => setContext(await unwrap("context", { id })));
  };
  const fill = (p: any) => {
    setFormOpen(true);
    setEdit(p);
    setArtist(p.artistId);
    setTitle(p.title);
    setTheme(p.theme);
    setZone(p.timezone);
    setTime(p.localTime ?? "");
    setCandidate(p.candidateMode);
    setScore(p.scoreMode);
    setProfile(p.text?.profileId ?? "");
    setBudget(p.text ? String(p.text.budgetMicros / 1e6) : "");
    setThreshold(p.threshold);
    setRevisions(p.maxRevisions);
    setMusicEnabled(!!p.music);
    setMusicProfile(p.music?.profileId ?? "");
    setMusicBudget(p.music ? String(p.music.budgetCredits) : "");
    setMusicMax(p.music ? String(p.music.maxCostPerRequestCredits) : "");
    setEvidence(p.music?.pricingEvidence ?? "");
    setConsent(false);
    setMusicConsent(false);
  };
  return (
    <section className="panel production-flow" aria-label="持久生产流水线">
      <div className="page-head">
        <div>
          <h2>每日计划</h2>
          <HelpNote label="流水线说明">
            到点先产出候选。每轮确认后进入作品；素材齐备后停在待发布。应用关闭、睡眠或注销时不运行，历史漏跑不补扣费。
          </HelpNote>
        </div>
        <Badge>默认仅本机候选</Badge>
      </div>
      <details open={formOpen}>
        <summary
          onClick={(e) => {
            e.preventDefault();
            setFormOpen(!formOpen);
          }}
        >
          {edit ? "编辑计划 · 保存后停用" : "新建每日计划"}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const p = await unwrap("savePlan", {
                expectedRevision: edit?.revision ?? null,
                plan: {
                  id: edit?.id ?? crypto.randomUUID(),
                  artistId,
                  title,
                  theme,
                  timezone,
                  localTime: time || null,
                  enabled: false,
                  candidateMode,
                  scoreMode,
                  text: textNeeded
                    ? {
                        profileId,
                        profileRevision: profile?.revision,
                        modelId: profile?.modelId ?? "deepseek-flash",
                        maxOutputTokens: 2048,
                        budgetMicros: Math.round(Number(budget) * 1e6),
                        consent,
                      }
                    : null,
                  music: musicEnabled
                    ? {
                        profileId: musicProfile,
                        profileRevision: mp?.revision,
                        modelId: mp?.modelId ?? "chirp-v6",
                        budgetCredits: Number(musicBudget),
                        maxCostPerRequestCredits: Number(musicMax),
                        pricingEvidence,
                        consent: musicConsent,
                      }
                    : null,
                  publication: null,
                  autoContinue: false,
                  threshold,
                  maxRevisions: revisions,
                  maxScoreRetries: 2,
                  maxRunsPerDay: 1,
                  template: null,
                },
              });
              setEdit(null);
              setFormOpen(false);
              setConsent(false);
              setMusicConsent(false);
              notify(
                "计划已保存并停用；可先手动生成本轮候选，再启用每日时间。",
              );
              return p;
            });
          }}
        >
          <div className="form-grid">
            <SelectArtist value={artistId} onChange={setArtist} />
            <label>
              计划名称
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            <label>
              每日当地时间
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label>
              IANA 时区
              <input
                value={timezone}
                onChange={(e) => setZone(e.target.value)}
                required
              />
            </label>
          </div>
          <ProductionFlowSchedule
            plan={{ timezone, localTime: time || null, enabled: false }}
          />
          <label>
            故事方向
            <textarea
              aria-label="故事方向"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              required
              maxLength={500}
            />
          </label>
          <div className="form-grid">
            <label>
              候选来源
              <select
                aria-label="候选来源"
                value={candidateMode}
                onChange={(e) => {
                  setCandidate(e.target.value);
                  setConsent(false);
                }}
              >
                <option value="local_template">
                  本地原创模板 · 无模型调用
                </option>
                <option value="deepseek">
                  DeepSeek 官方 API · 需要预算授权
                </option>
              </select>
            </label>
            <label>
              评分方式
              <select
                aria-label="评分方式"
                value={scoreMode}
                onChange={(e) => {
                  setScore(e.target.value);
                  setConsent(false);
                }}
              >
                <option value="rule_based">本地规则检查 · 非模型评分</option>
                <option value="deepseek">
                  DeepSeek 模型评分 · 未经人工校准
                </option>
              </select>
            </label>
            <label>
              通过阈值
              <input
                type="number"
                min={0}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
            <label>
              低分最多改写
              <input
                type="number"
                min={0}
                max={2}
                value={revisions}
                onChange={(e) => setRevisions(Number(e.target.value))}
              />
            </label>
          </div>
          {textNeeded && (
            <div className="panel">
              <h3>本轮文本预算</h3>
              <p>
                生成、评分和最多两次改写共享同一金额。USD 估算与音乐 credits
                分开记录；每天最多一轮，费用未知时冻结该配置。
              </p>
              <div className="form-grid">
                <label>
                  DeepSeek 配置
                  <select
                    value={profileId}
                    onChange={(e) => {
                      setProfile(e.target.value);
                      setConsent(false);
                    }}
                    required
                  >
                    <option value="">请选择</option>
                    {profiles
                      .filter((p) => p.providerId === "deepseek")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} · {p.modelId ?? "未选模型"}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  每轮上限 · USD
                  <input
                    type="number"
                    min="0.000001"
                    max="100"
                    step="0.000001"
                    value={budget}
                    onChange={(e) => {
                      setBudget(e.target.value);
                      setConsent(false);
                    }}
                    required
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                />
                允许此计划在已配置时间内、按上述每轮预算调用所选模型（每日最多一轮）
              </label>
            </div>
          )}
          <details>
            <summary>可选：音乐费用范围</summary>
            <label className="check">
              <input
                type="checkbox"
                checked={musicEnabled}
                onChange={(e) => {
                  setMusicEnabled(e.target.checked);
                  setMusicConsent(false);
                }}
              />
              候选逐轮确认后，允许准备音乐生成
            </label>
            <p>
              当前未取得可验证的每次收费上界。填写只记录范围；引擎仍会阻止收费，可改用官方生成后导入。
            </p>
            {musicEnabled && (
              <>
                <div className="form-grid">
                  <label>
                    谱乐配置
                    <select
                      value={musicProfile}
                      onChange={(e) => {
                        setMusicProfile(e.target.value);
                        setMusicConsent(false);
                      }}
                      required
                    >
                      <option value="">请选择</option>
                      {profiles
                        .filter((p) => p.providerId === "yourmusic")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    每轮总 credits
                    <input
                      type="number"
                      min={1}
                      value={musicBudget}
                      onChange={(e) => {
                        setMusicBudget(e.target.value);
                        setMusicConsent(false);
                      }}
                      required
                    />
                  </label>
                  <label>
                    单次最大 credits
                    <input
                      type="number"
                      min={1}
                      value={musicMax}
                      onChange={(e) => {
                        setMusicMax(e.target.value);
                        setMusicConsent(false);
                      }}
                      required
                    />
                  </label>
                </div>
                <label>
                  待核验价格依据
                  <input
                    value={pricingEvidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    required
                    maxLength={1000}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={musicConsent}
                    onChange={(e) => setMusicConsent(e.target.checked)}
                    required
                  />
                  确认上述音乐范围；仅价格核验通过后可执行
                </label>
              </>
            )}
          </details>
          <HelpNote label="计划运行说明">
            停用每日计划仅停止未来轮次；托盘“暂停自动创作”会暂停当前待执行阶段。每轮始终需要候选确认；本页不会自动注册系统任务或打开
            dot。dot 仍通过人工导出、文件导入。
          </HelpNote>
          <button
            disabled={
              busy ||
              (textNeeded && (!consent || !profile)) ||
              (musicEnabled && !musicConsent)
            }
          >
            保存停用计划
          </button>
          {edit && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEdit(null);
                setFormOpen(false);
              }}
            >
              取消编辑
            </button>
          )}
        </form>
      </details>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="flow-plans">
        {rows.plans.map((p: any) => (
          <article className="panel" key={p.id}>
            <div className="page-head">
              <div>
                <h3>{p.title}</h3>
                <ProductionFlowSchedule plan={p} />
                <p>每日最多 {p.maxRunsPerDay} 轮</p>
              </div>
              <Badge>{p.enabled ? "日程已启用" : "日程已停用"}</Badge>
            </div>
            <p>
              {p.candidateMode === "local_template" ? "本地模板" : "DeepSeek"} /{" "}
              {p.scoreMode === "rule_based" ? "规则检查" : "模型评分"} · 阈值{" "}
              {p.threshold} · 最多改写 {p.maxRevisions} 次
            </p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    unwrap("trigger", {
                      planId: p.id,
                      requestId: crypto.randomUUID(),
                    }),
                  )
                }
              >
                生成本轮候选
              </button>
              <button
                className="secondary"
                disabled={busy || (!p.enabled && !p.localTime)}
                onClick={() =>
                  void act(() =>
                    unwrap(p.enabled ? "disable" : "enable", {
                      id: p.id,
                      expectedRevision: p.revision,
                    }),
                  )
                }
              >
                {p.enabled ? "停用每日计划" : "启用每日计划"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => fill(p)}
              >
                编辑范围
              </button>
            </div>
          </article>
        ))}
      </div>
      <h3>本轮进度</h3>
      {rows.runs.length === 0 ? (
        <p className="muted">
          暂无生产轮次
        </p>
      ) : (
        <div className="actions">
          {[...rows.runs].reverse().map((r: any) => (
            <button
              className={selected === r.id ? "" : "secondary"}
              key={r.id}
              onClick={() => void selectRun(r.id)}
            >
              {r.title ?? r.plan?.title ?? r.localDate ?? r.id.slice(0, 8)} ·{" "}
              {label(r.state ?? r.stage)}
            </button>
          ))}
        </div>
      )}
      {run?.id && (
        <article className="panel flow-run">
          <div className="page-head">
            <div>
              <h3>{draft?.title ?? run.plan?.title ?? "生产轮次"}</h3>
              <p>
                {date(run.createdAt ?? run.at)} · {run.id.slice(0, 8)}
              </p>
            </div>
            <Badge>{label(run.state ?? run.stage)}</Badge>
          </div>
          <ol className="flow-steps">
            {[
              "调度",
              "候选",
              "评分 / 有界改写",
              "作品",
              "音乐任务",
              "素材",
              "待发布",
              "官方回执",
            ].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {(run.reasons ?? (run.reason ? [run.reason] : [])).map(
            (r: string) => (
              <p className="notice" key={r}>
                {label(r)}
              </p>
            ),
          )}
          {(run.score ?? candidate?.score) && (
            <p>
              评分来源：
              {(run.score ?? candidate.score).source === "model-scored"
                ? "模型评分 · 未经人工校准"
                : "本地规则检查"}{" "}
              · {(run.score ?? candidate.score).overall ?? "—"} /{" "}
              {run.plan?.threshold ?? threshold}
            </p>
          )}
          {run.score?.findings && (
            <ul>
              {run.score.findings.map((f: string) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <div className="form-grid flow-budget">
            <p>
              文本估算 USD {(Number(run.textSpentMicros ?? 0) / 1e6).toFixed(6)}
              <small>
                预留 {(Number(run.textReservedMicros ?? 0) / 1e6).toFixed(6)} /
                本轮上限{" "}
                {run.plan?.text ? run.plan.text.budgetMicros / 1e6 : "未授权"}
              </small>
            </p>
            <p>
              音乐 credits {run.musicSpentCredits ?? 0}
              <small>
                预留 {run.musicReservedCredits ?? 0} / 本轮上限{" "}
                {run.plan?.music?.budgetCredits ?? "未授权"} ·
                费用未知时预留不释放
              </small>
            </p>
          </div>
          {draft?.sections && (
            <details open>
              <summary>候选歌词与音乐提示词</summary>
              <pre className="lyrics">
                {draft.sections
                  .map((s: any) => "[" + s.kind + "]\n" + s.lines.join("\n"))
                  .join("\n\n")}
              </pre>
              <p>{draft.musicPrompts?.yourmusic?.positiveStyle}</p>
            </details>
          )}
          <div className="actions">
            {run.stage === "music" &&
              run.plan.music &&
              ["ready", "blocked"].includes(run.state) &&
              !context?.operations?.some(
                (o: any) => o.taskType === "music_submit",
              ) && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      unwrap("useManualAssets", {
                        id: run.id,
                        expectedRevision: run.revision,
                        consent: true,
                      }),
                    )
                  }
                >
                  改用官方生成后导入，不发送本轮音乐请求
                </button>
              )}
            <button
              className="secondary"
              disabled={
                busy ||
                run.stage !== "candidate" ||
                run.state !== "awaiting_approval"
              }
              onClick={() =>
                void act(() =>
                  unwrap("approve", {
                    id: run.id,
                    expectedRevision: run.revision,
                    stage: "candidate",
                    consent: true,
                  }),
                )
              }
            >
              确认当前候选，继续评分与生产
            </button>
            {run.workId && (
              <>
                <button onClick={() => go("track", run.workId)}>
                  打开作品 / 导入素材
                </button>
                <button className="secondary" onClick={() => go("publish")}>
                  查看发布中心
                </button>
              </>
            )}
            <button
              className="secondary"
              disabled={busy || !["blocked", "failed"].includes(run.state)}
              onClick={() =>
                void act(() =>
                  unwrap("retry", {
                    id: run.id,
                    expectedRevision: run.revision,
                  }),
                )
              }
            >
              重试可安全恢复的原阶段
            </button>
          </div>
          {run.versions?.length > 1 && (
            <details>
              <summary>候选版本记录 · {run.versions.length} 版</summary>
              {run.versions.map((v: any) => (
                <article key={v.id}>
                  <b>
                    {v.draft.title} ·{" "}
                    {v.source === "local_template" ? "本地模板" : "DeepSeek"} ·{" "}
                    {v.id.slice(0, 8)}
                  </b>
                  <pre className="lyrics">{v.pair.lyrics}</pre>
                </article>
              ))}
            </details>
          )}
          <details>
            <summary>阶段与原操作记录</summary>
            <ul>
              {run.history?.map((h: any, i: number) => (
                <li key={i}>
                  {date(h.at)} · {h.stage}
                </li>
              ))}
            </ul>
            {context?.operations?.map((o: any) => (
              <p key={o.id}>
                {o.taskType} · {o.state} · {o.id.slice(0, 8)} · {o.costState}
              </p>
            ))}
          </details>
          <HelpNote label="未知结果处理">
            结果未知时不重新生成或投稿；补齐原任务凭据、素材和授权后再继续。
          </HelpNote>
        </article>
      )}
      <details>
        <summary>真实发布接入状态</summary>
        <p>
          腾讯原生可见界面适配器：{capability?.available ? "可执行" : "阻塞"}
          。观察记录独立保存，不会写成客户端执行回执。
        </p>
        {capability?.reasons?.map((r: string) => (
          <p key={r}>{label(r)}</p>
        ))}
        <p>
          未取得本首歌的账号、音频与条款授权时不会投稿；其他发行平台及抖音视频接入状态见发布中心。
        </p>
      </details>
    </section>
  );
}
