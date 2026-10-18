import React, { useEffect, useState } from "react";
import { useStudio, Badge } from "../context";
import {workflowLabel} from '../workflow-labels';
import HelpNote from "./HelpNote";
export default function MusicCandidates({ draft }: { draft: any }) {
  const { call, data, play, notify } = useStudio();
  const [rows, setRows] = useState<any>({ operations: [], candidates: [] }),
    [model, setModel] = useState(data.mode === "simulation" ? "chirp-v6" : ""),
    [busy, setBusy] = useState(false);
  const refresh = async () => setRows(await call("music.list"));
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="panel">
      <h3>音乐候选</h3>
      <Badge>{data.mode==='simulation'?'离线诊断音':'真实调用未启用'}</Badge>
      <HelpNote label="音乐候选说明">
        {data.mode === "simulation"
          ? "离线链路测试：将生成两个本地 1 秒诊断音，内容相同，不是 AI 歌曲。"
          : "公开 API 映射已实现；账户、模型许可、隐私、价格和结果核对合同未验收，真实调用禁用。"}
      </HelpNote>
      <label>
        账户允许的模型 ID
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="待提供账户模型列表"
        />
      </label>
      <button
        disabled={!draft || !model || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const op = await call("music.prepare", {
              requestId: crypto.randomUUID(),
              draftId: draft.id,
              expectedPairHash: draft.pairHash,
              accountRef:
                data.mode === "simulation" ? "fixture-account" : "unconfigured",
              modelId: model,
              candidateLimit: 2,
              budgetLimit: data.mode === "simulation" ? 10 : 0,
            });
            notify(
              op.state === "blocked"
                ? "尚不满足音乐调用条件"
                : "已准备离线音频链路测试",
            );
            await refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {data.mode === "simulation"
          ? "准备 A/B 诊断音（模拟）"
          : "检查音乐接入条件"}
      </button>
      {rows.operations
        .filter((o: any) => o.draftId === draft?.id)
        .map((o: any) => {
          const failedDownload = o.state === "download_failed" || rows.candidates.some((c: any) => c.operationId === o.id && c.state === "download_failed");
          return (
          <article key={o.id}>
            <Badge>
              {o.source === "fixture" ? "模拟 · " : ""}
              {workflowLabel(o.state)}
            </Badge>
            <small>
              曲目查询引用 {o.songIds?.length ?? 0} · 费用 {o.costState} ·
              最多两首
            </small>
            {o.reasons.map((r: string) => (
              <p key={r}>{workflowLabel(r)}</p>
            ))}
            {["accepted", "polling", "download_failed"].includes(o.state) && (
              <button disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  await call(failedDownload ? "music.retryDownloads" : "music.reconcile", { id: o.id });
                  await refresh();
                  notify(failedDownload ? "已请求重试原单音频下载；未重新生成。" : "已请求核对原单。");
                } catch {
                  notify("原单恢复未完成，请查看任务状态后重试。");
                } finally {
                  setBusy(false);
                }
              }}>
                {failedDownload ? "重试原单音频下载（不重新生成）" : <>
                核对原订单 / 重试下载
                </>}
              </button>
            )}
          </article>
          );
        })}
      {rows.candidates
        .filter((c: any) => c.draftId === draft?.id)
        .map((c: any) => (
          <div className="panel" key={c.id}>
            <h4>
              {c.ordinal === 0 ? "A" : "B"} ·{" "}
              {c.source === "fixture" ? "本地诊断音（不是歌曲）" : "候选音频"}
            </h4>
            <Badge>{workflowLabel(c.state)}</Badge>
            <small>
              下载尝试 {c.downloadAttempts}/4 · 来源 {c.provider}
            </small>
            <button
              disabled={!c.assetId || c.state !== "ready"}
              onClick={() =>
                play({
                  id: c.id,
                  title: "本地诊断音 · 非 AI 歌曲",
                  artistId: draft.artistId,
                  assets: { audio_A: c.assetId },
                })
              }
            >
              播放已验证本地音频
            </button>
            <button
              disabled={!c.assetId || c.state !== "ready" || !!c.selectedAt}
              onClick={async () => {
                await call("candidate.select", {
                  requestId: crypto.randomUUID(),
                  candidateId: c.id,
                  seriesId: draft.seriesId ?? null,
                  expectedSeriesRevision: draft.seriesId
                    ? draft.seriesBaseRevision
                    : null,
                });
                notify(
                  draft.seriesId
                    ? "已人工选入系列并推进确认章节"
                    : "已人工选入作品库",
                );
                await refresh();
              }}
            >
              {c.selectedAt
                ? "已选入"
                : draft.seriesId
                  ? "人工选入系列"
                  : "人工选入作品库"}
            </button>
            {!c.assetId && <p>没有有效本地音频，暂不可试听。</p>}
          </div>
        ))}
    </section>
  );
}
