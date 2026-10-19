import HelpNote from "./HelpNote";
import React, { useEffect, useState } from "react";
import { useStudio, Badge } from "../context";
import type { ApiProfile } from "../../shared/api-profiles";
import MusicCandidates from "./MusicCandidates";
const stateNames: Record<string, string> = {
  prepared: "已准备，尚未调用",
  dispatching: "请求处理中",
  complete: "文本已返回",
  invalid: "需要修订或核对",
  unknown: "结果或费用未知，禁止重发",
};
export default function LiveTextWorkspace() {
  const { data, notify, go } = useStudio();
  const [profiles, setProfiles] = useState<
      (ApiProfile & { configured: boolean })[]
    >([]),
    [profileId, setProfile] = useState(""),
    [artistId, setArtist] = useState(data.artists[0]?.id ?? "");
  const [instruction, setInstruction] = useState(""),
    [modelId, setModel] = useState("deepseek-flash"),
    [budget, setBudget] = useState(""),
    [tokens, setTokens] = useState(2048),
    [revisions, setRevisions] = useState(0),
    [consent, setConsent] = useState(false),
    [feedback, setFeedback] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [jobs, setJobs] = useState<any[]>([]),
    [context, setContext] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const unwrap = async (
    action: "prepare" | "run" | "list" | "context",
    input: unknown = {},
  ) => {
    const r = await window.rainfall.liveText(action, input);
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  };
  const read = async (id?: string) => {
    const rows = await unwrap("list");
    setJobs(rows);
    const selected = id ?? context?.job?.id ?? rows.at(-1)?.id;
    if (selected) setContext(await unwrap("context", { id: selected }));
  };
  useEffect(() => {
    if (data.mode !== "production") return;
    let current = true;
    void (async () => {
      const r = await window.rainfall.call("apiProfile.list");
      if (!r.ok) throw Error("无法读取文本配置");
      const items = [];
      for (const p of r.value.filter(
        (p: ApiProfile) => p.providerId === "deepseek" && p.kind === "text",
      )) {
        const s = await window.rainfall.apiCredentialStatus({
          profileId: p.id,
        });
        items.push({ ...p, configured: s.ok && s.value.configured });
      }
      if (current) {
        setProfiles(items);
        if (items.length === 1) setProfile(items[0].id);
        await read();
      }
    })().catch(() => {
      if (current) setError("无法读取本机文本配置或任务，请刷新。");
    });
    return () => {
      current = false;
    };
  }, [data.mode]);
  if (data.mode !== "production") return null;
  const profile = profiles.find((p) => p.id === profileId),
    job = context?.job,
    operation = context?.operation,
    draft = context?.draft;
  const resetConsent = () => {
    setConsent(false);
    setRequestId(crypto.randomUUID());
  };
  const act = async (action: "prepare" | "run") => {
    setBusy(true);
    setError("");
    try {
      const result =
        action === "prepare"
          ? await unwrap("prepare", {
              requestId,
              profileId,
              expectedProfileRevision: profile!.revision,
              artistId,
              instruction,
              parentDraftId: null,
              modelId,
              maxOutputTokens: tokens,
              budgetMicros: Math.round(Number(budget) * 1e6),
              maxRevisions: revisions,
              consent: true,
            })
          : await unwrap("run", {
              id: job.id,
              expectedRevision: job.revision,
              ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
            });
      await read(result.id);
      notify(
        action === "prepare"
          ? "本轮任务已持久化，尚未调用模型"
          : "本轮结果已记录，请查看实际状态与用量",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "操作未完成，请检查配置及预算。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" aria-label="DeepSeek真实文本工作区">
      <h2>DeepSeek 歌词与曲风</h2>
      <Badge>本地检查 · 未评分</Badge>
      <HelpNote label="文本任务说明">
        逐轮保存真实供应商来源、版本及用量。先准备，再明确调用；本地规则检查不代表模型评分或音乐质量通过。预算不足、模型不符或结果未知时停止，不自动重发。
      </HelpNote>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("prepare");
        }}
      >
        <div className="form-grid">
          <label>
            文本账号配置
            <select
              required
              value={profileId}
              disabled={busy}
              onChange={(e) => {
                setProfile(e.target.value);
                resetConsent();
              }}
            >
              <option value="">选择 DeepSeek 配置</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ·{" "}
                  {p.configured ? "Key已存，连接待核验" : "未保存Key"}
                </option>
              ))}
            </select>
          </label>
          <label>
            创作者
            <select
              required
              value={artistId}
              onChange={(e) => {
                setArtist(e.target.value);
                resetConsent();
              }}
            >
              {data.artists.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            文本模型
            <select
              value={modelId}
              onChange={(e) => {
                setModel(e.target.value);
                resetConsent();
              }}
            >
              <option value="deepseek-flash">deepseek-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            </select>
          </label>
          <label>
            本轮文本预算（美元）
            <input
              type="number"
              required
              min="0.001"
              max="100"
              step="0.001"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                resetConsent();
              }}
            />
          </label>
          <label>
            每次输出 token 上限
            <input
              type="number"
              required
              min="256"
              max="16384"
              value={tokens}
              onChange={(e) => {
                setTokens(Number(e.target.value));
                resetConsent();
              }}
            />
          </label>
          <label>
            本轮最多改写次数
            <select
              value={revisions}
              onChange={(e) => {
                setRevisions(Number(e.target.value));
                resetConsent();
              }}
            >
              <option value={0}>0 · 只生成一次</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
        </div>
        <label>
          故事、曲风与创作要求
          <textarea
            required
            maxLength={10000}
            rows={4}
            value={instruction}
            onChange={(e) => {
              setInstruction(e.target.value);
              resetConsent();
            }}
          />
        </label>
        <p>费用按用量估算（USD）· 非最终账单</p>
        <HelpNote label="费率参考">
          费用按官方峰值价格和返回 usage 保守估算（美元），不是最终账单。Flash
          每百万输入/输出 token 为 $0.30/$1.20；Pro 为 $1.32/$3.96，价格依据
          2026-10-16。音乐生成、封面出图及平台授权另行处理。
        </HelpNote>
        <label className="live-text-consent">
          <input
            type="checkbox"
            aria-label="确认本轮文本调用预算"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          确认本轮文本调用预算及最多改写次数；准备本身不联网生成。
        </label>
        <button disabled={busy || !consent || !profile?.configured}>
          准备本轮文本任务
        </button>{" "}
        <button type="button" onClick={() => go("accounts")}>
          账号与只读连接检查
        </button>
      </form>
      {!profiles.some((p) => p.configured) && (
        <p className="notice">
          尚无已保存 Key 的 DeepSeek 配置。未连接模型，未产生收费调用。
        </p>
      )}
      <div className="row">
        <label>
          持久文本任务
          <select
            value={job?.id ?? ""}
            onChange={(e) =>
              void read(e.target.value).catch(() => setError("任务读取失败"))
            }
          >
            <option value="">选择本轮任务</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.instruction.slice(0, 30)} · {stateNames[j.state] ?? j.state}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          onClick={() => void read().catch(() => setError("刷新失败"))}
        >
          刷新文本任务
        </button>
      </div>
      {job && (
        <div role="status">
          <p>
            {stateNames[job.state] ?? job.state} · 调用 {job.callCount}/
            {job.maxRevisions + 1} · 已用估算 $
            {(job.spentMicros / 1e6).toFixed(6)} / 预算 $
            {(job.budgetMicros / 1e6).toFixed(6)}
            {" · 预留 $"}{(job.reservedMicros / 1e6).toFixed(6)}
          </p>
          {operation?.result&&<Badge>{operation.result.estimatedCostMicros===null?"费用待核实 · 保留预算":"费用仅为估算"}</Badge>}
          <details><summary>用量与请求记录</summary><small>
            任务 {job.id} · 来源 DeepSeek API
          </small>
          {operation?.result && (
            <p>
              实际模型：{operation.result.providerModel ?? "未知"} · 请求 ID：
              {operation.result.providerRequestId ?? "未知"} · 输入/输出 token：
              {operation.result.usage
                ? `${operation.result.usage.prompt_tokens}/${operation.result.usage.completion_tokens}`
                : "未知"}{" "}
              · 费用
              {operation.result.estimatedCostMicros === null
                ? "未核实（保留预算）"
                : "仅为估算"}
            </p>
          )}
          </details>
          {job.reasons.map((r: string) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      )}
      {job &&
        ["prepared", "complete", "invalid"].includes(job.state) &&
        job.callCount < job.maxRevisions + 1 && (
          <div>
            {job.callCount > 0 && (
              <label>
                改写反馈
                <textarea
                  value={feedback}
                  maxLength={4000}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </label>
            )}
            <button
              className="primary"
              disabled={busy || (job.state === "complete" && !feedback.trim())}
              onClick={() => void act("run")}
            >
              {busy
                ? "等待原请求结果…"
                : job.callCount
                  ? "按本轮剩余预算明确改写一次"
                  : "按已确认预算调用一次 DeepSeek"}
            </button>
          </div>
        )}
      {draft && (
        <details open>
          <summary>{draft.draft.title} · 真实返回版本 · 仅本地规则检查</summary>
          <pre>{draft.pair.lyrics}</pre>
          <p>{draft.pair.musicPrompt}</p>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(draft.pair.lyrics)
                .then(() => notify("已复制本版歌词"))
            }
          >
            复制本版歌词
          </button>{" "}
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(draft.pair.musicPrompt)
                .then(() => notify("已复制本版曲风"))
            }
          >
            复制本版曲风
          </button>
          <MusicCandidates draft={draft} />
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
