import React, { useEffect, useRef, useState } from "react";
import { useStudio } from "../context";
import GenerationRoutes, {
  defaultRoutes,
  generationRoleNames,
} from "./GenerationRoutes";
import ProviderPlanStatus from "./ProviderPlanStatus";
import ChoiceButtons from "./ChoiceButtons";
import MusicStylePicker from "./MusicStylePicker";
export default function ManualCreation() {
  const { data, call, go, notify } = useStudio(),
    [artistId, setArtist] = useState(data.artists[0]?.id ?? ""),
    [story, setStory] = useState("下雨的傍晚，两个人第一次在同一屋檐下相遇。"),
    [stage, setStage] = useState("相识"),
    [styleTemplate, setStyleTemplate] = useState(""),
    [routing, setRouting] = useState(defaultRoutes),
    [cover, setCover] = useState(false),
    [music, setMusic] = useState(false),
    [budget, setBudget] = useState(""),
    [consent, setConsent] = useState(false),
    [rows, setRows] = useState<any[]>([]),
    [status, setStatus] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const artist = data.artists.find((a: any) => a.id === artistId);
  const refresh = async () => {
    const [r, s] = await Promise.all([
      call("manualCreation.list"),
      call("planCenter.status"),
    ]);
    setRows(r);
    setStatus(s);
  };
  useEffect(() => {
    void refresh().catch(() => {});
    const t = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await call("manualCreation.prepare", {
        requestId: requestId.current,
        artistId,
        storyBeat: story,
        storyStage: stage,
        ...(styleTemplate.trim() ? { styleTemplate } : {}),
        routing,
        outputs: { lyrics: true, cover, music },
        text: {
          consent,
          budgetMicros: budget ? Math.round(Number(budget) * 1e6) : undefined,
        },
        music: { consent: false },
      });
      requestId.current = crypto.randomUUID();
      notify(
        r.run.state === "blocked"
          ? "任务已保存，请查看需处理项"
          : "已创建单次创作任务",
      );
      await refresh();
    } catch (e: any) {
      setError(e.code ?? e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="panel" aria-label="单次 AI 创作">
      <h2>单次 AI 创作</h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div>
            <span>创作艺人</span>
            <ChoiceButtons
              label="创作艺人"
              value={artistId}
              choices={data.artists.map((a: { id: string; name: string }) => ({
                value: a.id,
                label: a.name,
              }))}
              disabled={busy}
              onChange={(id) => {
                setArtist(id);
                setConsent(false);
              }}
            />
          </div>
          <label>
            本次故事阶段
            <input
              aria-label="本次故事阶段"
              value={stage}
              maxLength={1000}
              onChange={(e) => setStage(e.target.value)}
            />
          </label>
        </div>
        {artist && (
          <details>
            <summary>已带入艺人风格 · v{artist.revision}</summary>
            <dl>
              {Object.entries(artist.defaults).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>
                    {(
                      {
                        genre: "曲风",
                        voice: "人声",
                        lyricTone: "歌词语气",
                        bpmMin: "BPM 下限",
                        bpmMax: "BPM 上限",
                        language: "语言",
                        mood: "情绪",
                        duration: "时长（秒）",
                        instruments: "乐器",
                        seriesStory: "系列故事线",
                        coverStyle: "封面风格",
                      } as any
                    )[k] ?? k}
                  </dt>
                  <dd>{String(v)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        )}
        <label>
          本次故事
          <textarea
            aria-label="本次故事"
            required
            maxLength={10000}
            value={story}
            onChange={(e) => setStory(e.target.value)}
          />
        </label>
        <MusicStylePicker
          value={styleTemplate}
          onChange={setStyleTemplate}
          inherited={artist?.defaults?.genre}
          maxLength={4000}
          disabled={busy}
        />
        <GenerationRoutes
          value={routing}
          onChange={(r) => {
            setRouting(r);
            setConsent(false);
          }}
          disabled={busy}
        />
        <div className="button-row">
          <label>
            <input
              type="checkbox"
              checked={cover}
              onChange={(e) => setCover(e.target.checked)}
            />
            准备封面
          </label>
          <label>
            <input
              type="checkbox"
              checked={music}
              onChange={(e) => setMusic(e.target.checked)}
            />
            准备音乐任务
          </label>
        </div>
        <p className="muted">音乐执行尚未授权；需编辑任务核对模型与额度。</p>
        <label>
          文本总额度（所选配置币种）
          <input
            aria-label="单次文本额度"
            type="number"
            min={0.000001}
            max={100}
            step={0.000001}
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              setConsent(false);
            }}
          />
        </label>
        <label className="check">
          <input
            aria-label="授权单次文本额度"
            type="checkbox"
            checked={consent}
            disabled={!budget}
            onChange={(e) => setConsent(e.target.checked)}
          />
          允许此任务在上述总额度内生成与评分；需配置价格和 Key
        </label>
        <button
          className="primary"
          disabled={busy || !artistId || !story.trim()}
        >
          {busy ? "保存中…" : "创建单次任务"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <h3>单次任务</h3>
      {rows
        .slice()
        .reverse()
        .map((row) => (
          <article className="panel" key={row.id}>
            <div className="section-title">
              <strong>
                {row.run?.snapshot.storyContext?.storyBeat?.slice(0, 50)}
              </strong>
              <span>
                {row.run?.state === "blocked"
                  ? "需处理"
                  : row.run?.state === "stopped"
                    ? "已停止"
                    : (row.run?.state ?? "状态待核对")}
              </span>
            </div>
            <p>
              艺人 {row.run?.snapshot.artistSnapshot?.name} · v
              {row.run?.snapshot.artistSnapshot?.revision}
              {row.run?.snapshot.styleTemplate &&
                " · " + row.run.snapshot.styleTemplate}
            </p>
            {row.run?.snapshot.routeSnapshot && (
              <div className="plan-tags">
                {(["text", "image", "music"] as const).map((role) => (
                  <span key={role}>
                    {generationRoleNames[role]}：
                    {row.run.snapshot.routeSnapshot[role].providerId ??
                      "未配置"}{" "}
                    /{" "}
                    {row.run.snapshot.routeSnapshot[role].modelId ??
                      "外部导入或未配置"}
                  </span>
                ))}
              </div>
            )}
            <ProviderPlanStatus
              status={status?.providerText?.find(
                (j: any) => j.runId === row.runId,
              )}
            />
            <div className="button-row">
              <button onClick={() => go("plans", row.runId)}>
                查看任务与需处理项
              </button>
              {row.run &&
                !["completed", "stopped", "failed"].includes(row.run.state) && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await call("planCenter.stop", { runId: row.runId });
                        await refresh();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    停止后续步骤
                  </button>
                )}
            </div>
          </article>
        ))}
      {!rows.length && (
        <p className="muted">还没有单次任务。未授权时会保存任务并列出缺项。</p>
      )}
    </section>
  );
}
