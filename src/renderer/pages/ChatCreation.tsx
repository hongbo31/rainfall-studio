import HelpNote from "../components/HelpNote";
import React, { useEffect, useState } from "react";
import { useStudio, PageHead, Badge, SelectArtist } from "../context";
import MusicCandidates from "../components/MusicCandidates";
import LiveMusicWorkspace from "../components/LiveMusicWorkspace";
import LiveTextWorkspace from "../components/LiveTextWorkspace";
import ManualCreation from '../components/ManualCreation';
const reasonNames: Record<string, string> = {
  TEXT_CONFIGURATION_REQUIRED: "尚未选择并验证文本供应商/协议/模型",
  LIVE_EXECUTION_DISABLED: "真实服务执行尚未启用",
  BUDGET_INSUFFICIENT: "本轮或当日预算不足",
  QUALITY_POLICY_UNAPPROVED: "评分参数与人工校准尚未确认",
  PROVIDER_RISK_FROZEN: "供应商存在未知操作，额度冻结",
  COST_OR_OUTCOME_UNKNOWN: "结果或费用未知，请人工核对",
  LOCKED_CONTENT_CHANGED: "固定片段发生冲突，转人工处理",
};
export default function ChatCreation() {
  const [seriesId, setSeries] = useState("");
  const { data, call, notify } = useStudio();
  const [rows, setRows] = useState<any>({
      sessions: [],
      turns: [],
      drafts: [],
      evaluations: [],
    }),
    [artist, setArtist] = useState(data.artists[0]?.id ?? ""),
    [sessionId, setSession] = useState<string>(crypto.randomUUID()),
    [instruction, setInstruction] = useState(
      "写一首雨中初次相识的歌，情绪克制但温暖",
    ),
    [lock, setLock] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => setRows(await call("conversation.list"));
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, []);
  const session = rows.sessions.find((s: any) => s.id === sessionId),
    turns = rows.turns.filter((t: any) => t.sessionId === sessionId),
    drafts = rows.drafts.filter((d: any) => d.sessionId === sessionId),
    [selected, setSelected] = useState("");
  const active = drafts.find((d: any) => d.id === selected) ?? drafts.at(-1),
    report = rows.evaluations.find((e: any) => e.draftId === active?.id);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const t = await call("conversation.generate", {
        requestId: crypto.randomUUID(),
        sessionId,
        artistId: artist,
        expectedRevision: session?.revision ?? 0,
        instruction,
        parentDraftId: session?.draftId ?? null,
        lockedQuotes: lock.split("\n").filter(Boolean),
        profileId: null,
        seriesId: seriesId || null,
        budgetLimit: 100,
      });
      notify(
        t.state === "blocked"
          ? "想法已保存；应用内 AI 生成暂未启用，请查看待补配置或导入外部草稿。"
          : "已创建离线示例任务",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead title="AI 聊天创作" />
      <ManualCreation />
      <details className="panel"><summary>历史创作与旧任务（保留原路线）</summary>
      <LiveMusicWorkspace />
      <LiveTextWorkspace />
      <p className="notice">
        {data.mode === "simulation"
          ? "离线样本"
          : "保存想法 · 不调用模型"}
      </p>
      <HelpNote label="创作模式说明">
        {data.mode === "simulation"
          ? "离线原创 fixture：固定样本与模拟评分，不使用模型或网络；fixture credit 不是货币。"
          : "手动准备本次文字或音乐创作。模型 API 和收件目录可在配置中心设置。"}
      </HelpNote>
      <div className="split">
        <section className="panel">
          <h2>创作对话</h2>
          <SelectArtist
            value={artist}
            onChange={(v) => {
              setArtist(v);
              setSession(crypto.randomUUID());
            }}
          />
          <label>
            系列
            <select
              value={seriesId}
              onChange={(e) => {
                setSeries(e.target.value);
                setSession(crypto.randomUUID());
              }}
            >
              <option value="">独立创作</option>
              {data.series.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            历史对话
            <select
              value={sessionId}
              onChange={(e) => setSession(e.target.value)}
            >
              <option value={sessionId}>当前对话</option>
              {rows.sessions
                .filter((s: any) => s.artistId === artist && s.id !== sessionId)
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          <button onClick={() => setSession(crypto.randomUUID())}>
            新对话
          </button>
          <form onSubmit={send}>
            <label>
              本轮要求
              <textarea
                aria-label="本轮要求"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                required
                maxLength={10000}
              />
            </label>
            <label>
              固定歌词片段（每行一段）
              <textarea
                aria-label="固定歌词片段"
                value={lock}
                onChange={(e) => setLock(e.target.value)}
                placeholder="固定内容发生冲突时转人工，不静默覆盖"
              />
            </label>
            <button className="primary" disabled={busy}>
              {data.mode === "simulation" ? "运行离线样本" : "保存想法"}
            </button>
          </form>
          {turns.map((t: any) => (
            <article className="panel" key={t.id}>
              <p>{t.instruction}</p>
              <Badge>
                {t.source === "fixture" ? "模拟 · " : ""}
                {t.state}
              </Badge>
              <small>
                已改写 {t.revisionCount}/2 · 模拟额度 {t.spent}
              </small>
              {t.reasons.map((r: string) => (
                <p key={r}>{reasonNames[r] ?? r}</p>
              ))}
            </article>
          ))}
        </section>
        <section className="panel">
          <h2>版本与评分</h2>
          <select
            value={active?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">选择版本</option>
            {drafts.map((d: any, i: number) => (
              <option key={d.id} value={d.id}>
                版本 {i + 1} · {d.draft.title}
              </option>
            ))}
          </select>
          {active ? (
            <>
              <Badge>
                {active.source === "fixture"
                  ? "离线样本"
                  : active.source === "deepseek-api"
                    ? "DeepSeek 返回 · 待评分"
                    : active.source === "local-inbox"
                      ? "本地导入 · 来源待核实"
                      : "来源待核实"}
              </Badge>
              <h3>{active.draft.title}</h3>
              <p>{active.draft.storyBeat}</p>
              {active.draft.sections.map((s: any) => (
                <pre key={s.id}>
                  [{s.kind}]{"\n"}
                  {s.lines.join("\n")}
                </pre>
              ))}
              <h3>音乐提示</h3>
              <p>{active.draft.musicPrompts.yourmusic.positiveStyle}</p>
              {report && (
                <>
                  <h3>模拟评分：{report.decision.state}</h3>
                  <p>
                    L {report.decision.scores.L ?? "—"} / M{" "}
                    {report.decision.scores.M ?? "—"} / C{" "}
                    {report.decision.scores.C ?? "—"} / 总分{" "}
                    {report.decision.scores.S ?? "—"}
                  </p>
                  <HelpNote label="评分说明">分数不代表真实听感；未授权音乐生成。</HelpNote>
                  {report.primary
                    .flatMap((a: any) => a.findings)
                    .map((f: any) => (
                      <p key={f.id}>
                        {f.owner}：{f.impact}；{f.suggestion}
                      </p>
                    ))}
                </>
              )}
            </>
          ) : (
            <>
              <p>暂无版本</p>
            </>
          )}
        </section>
      </div>
      <MusicCandidates draft={active} />
      {active?.parentDraftId && (
        <details className="panel">
          <summary>与父版本对照</summary>
          <div className="split">
            <pre>
              {rows.drafts.find((d: any) => d.id === active.parentDraftId)?.pair
                .lyrics ?? "父版本不在当前对话中"}
            </pre>
            <pre>{active.pair.lyrics}</pre>
          </div>
        </details>
      )}
      </details>
    </>
  );
}
