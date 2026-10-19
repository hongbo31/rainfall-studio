import React, { useEffect, useMemo, useState } from "react";
import { useStudio } from "../context";
import HelpNote from "./HelpNote";
import type {
  DirectoryTaskSource,
  DirectoryTaskEntry,
  DirectoryTaskRequest,
} from "../../shared/directory-tasks";
import type { PlanCenterPlan } from "../../shared/plan-center";

type DirectoryError = {
  id?: string;
  sourceId?: string;
  file?: string;
  code: string;
  at?: string;
};
type Status = {
  sources: DirectoryTaskSource[];
  requests: DirectoryTaskEntry[];
  errors: DirectoryError[];
  plans: PlanCenterPlan[];
};
const stateNames: Record<string, string> = {
  queued: "排队中",
  bound: "已关联运行",
  completed: "已完成",
  blocked: "受阻",
  stopped: "已停止",
};
const errorNames: Record<string, string> = {
  DIRECTORY_ROOT_UNAVAILABLE: "目录已不可用，请恢复文件夹或更换目录。",
  REVISION_CONFLICT: "配置已变化，请刷新后重试。",
  DIRECTORY_PLAN_CHANGED: "计划已更新，请重新保存目录绑定。",
  DIRECTORY_SOURCE_PAUSED: "扫描已暂停，请先启用扫描。",
  DIRECTORY_SCOPE_REJECTED: "此目录不在可用范围，请选择独立的任务目录。",
  DIRECTORY_SOURCE_OVERLAP: "目录与已有来源重叠，请选择独立目录。",
  DIRECTORY_READY_HASH_MISMATCH: "就绪标记与请求内容不一致。",
  DIRECTORY_READY_IDENTITY_MISMATCH: "就绪标记与请求版本不一致。",
  DIRECTORY_REQUEST_SCHEMA: "请求字段不符合任务格式。",
  DIRECTORY_REQUEST_PLAN_MISMATCH: "请求与此目录绑定的计划版本不一致。",
  DIRECTORY_REQUEST_REVISION_CONFLICT: "同一请求版本的内容发生冲突。",
  DIRECTORY_REQUEST_STALE_REVISION: "收到较早的请求版本，已拒绝。",
  DIRECTORY_REQUEST_INVALID_JSON: "请求不是有效的 JSON 文件。",
  DIRECTORY_STOP_REQUESTED: "已请求停止后续阶段。",
  DIRECTORY_FILE_CHANGED: "文件仍在变化，等待稳定后重试。",
};
const errorText = (code?: string) =>
  code
    ? (errorNames[code] ?? "目录请求未完成，请核对文件和计划。")
    : "操作未完成，请刷新后重试。";
const time = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未扫描";

function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DirectorySourceCard({
  source,
  plans,
  refresh,
}: {
  source: DirectoryTaskSource;
  plans: PlanCenterPlan[];
  refresh: () => Promise<void>;
}) {
  const { call, notify } = useStudio();
  const [planId, setPlanId] = useState(source.planId ?? "");
  const [interval, setIntervalValue] = useState(String(source.intervalSeconds));
  const [readiness, setReadiness] = useState(source.readiness);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setPlanId(source.planId ?? "");
    setIntervalValue(String(source.intervalSeconds));
    setReadiness(source.readiness);
  }, [source.id, source.revision]);
  const plan = plans.find((p) => p.id === planId),
    savedPlan = plans.find((p) => p.id === source.planId);
  const dirty =
    planId !== (source.planId ?? "") ||
    Number(interval) !== source.intervalSeconds ||
    readiness !== source.readiness;
  const stale =
    !!source.planId &&
    (!savedPlan || savedPlan.revision !== source.planRevision);
  const validInterval =
    Number.isInteger(Number(interval)) &&
    Number(interval) >= 5 &&
    Number(interval) <= 86400;
  const sample = useMemo<DirectoryTaskRequest | null>(
    () =>
      source.planId && source.planRevision
        ? {
            schemaVersion: 1,
            requestId: crypto.randomUUID(),
            revision: 1,
            planId: source.planId,
            planRevision: source.planRevision,
          }
        : null,
    [source.id, source.planId, source.planRevision],
  );
  const sampleText = sample ? JSON.stringify(sample, null, 2) + "\n" : "";
  const act = async (operation: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      if (message) notify(message);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : undefined));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const identity = { id: source.id, expectedRevision: source.revision };
  return (
    <article className="directory-source" aria-label="任务目录配置">
      <div className="directory-heading">
        <h3>任务目录</h3>
        <span className={"directory-status" + (source.enabled ? " on" : "")}>
          {source.enabled ? "扫描已启用" : "已暂停"}
        </span>
      </div>
      <div className="directory-path">
        <code>{source.root}</code>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(() => call("directoryTasks.chooseDirectory", identity))
          }
        >
          更换目录
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!plan || !validInterval) return;
          void act(
            () =>
              call("directoryTasks.save", {
                ...identity,
                planId: plan.id,
                planRevision: plan.revision,
                intervalSeconds: Number(interval),
                readiness,
              }),
            "目录设置已保存，扫描保持暂停。",
          );
        }}
      >
        <div className="directory-fields">
          <label>
            绑定计划
            <select
              aria-label="绑定计划"
              value={planId}
              disabled={busy}
              required
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">选择已保存的计划</option>
              {source.planId && !savedPlan && (
                <option value={source.planId}>原计划已不可用</option>
              )}
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · v{p.revision}
                </option>
              ))}
            </select>
          </label>
          <label>
            扫描间隔（秒）
            <input
              aria-label="扫描间隔（秒）"
              type="number"
              min="5"
              max="86400"
              step="1"
              required
              disabled={busy}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
            />
          </label>
          <label>
            接收方式
            <select
              aria-label="接收方式"
              value={readiness}
              disabled={busy}
              onChange={(e) =>
                setReadiness(e.target.value as DirectoryTaskSource["readiness"])
              }
            >
              <option value="stable-json">稳定 JSON 文件</option>
              <option value="ready-package">带就绪标记的请求包</option>
            </select>
          </label>
        </div>
        <div className="directory-actions">
          <button type="submit" disabled={busy || !plan || !validInterval}>
            保存并保持暂停
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              busy || source.enabled || dirty || stale || !source.planId
            }
            onClick={() =>
              void act(
                () => call("directoryTasks.resume", identity),
                "已启用目录扫描。",
              )
            }
          >
            启用扫描
          </button>
          <button
            type="button"
            disabled={busy || !source.enabled}
            onClick={() =>
              void act(
                () => call("directoryTasks.pause", identity),
                "已暂停扫描；已开始的运行可在计划中心查看。",
              )
            }
          >
            暂停扫描
          </button>
          <button
            type="button"
            disabled={busy || !source.enabled || dirty || stale}
            onClick={() =>
              void act(
                () => call("directoryTasks.scanNow", identity),
                "已完成本次目录检查，请查看请求状态。",
              )
            }
          >
            扫描一次
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(
                () => call("directoryTasks.stop", identity),
                "已请求停止此目录任务的后续阶段。",
              )
            }
          >
            停止目录任务
          </button>
          <HelpNote label="暂停与停止">
            暂停只停止接收新文件。停止目录任务会同时请求停止已关联运行的后续阶段；已发出的外部请求以计划中心的实际状态为准。保存设置会暂停扫描，重新启用时核对计划版本。
          </HelpNote>
        </div>
      </form>
      {dirty && (
        <p className="directory-note">
          有未保存的更改。请求示例仍使用已保存的计划版本。
        </p>
      )}
      {stale && (
        <p className="directory-warning" role="status">
          计划已更新，请重新保存目录绑定后启用。
        </p>
      )}
      {(error || source.error) && (
        <p className="directory-error" role="alert">
          {error || errorText(source.error)}
        </p>
      )}
      <p className="directory-note">
        最近扫描：{time(source.lastScanAt)}
        {source.planRevision
          ? ` · 已绑定计划 v${source.planRevision}`
          : " · 尚未绑定计划"}
      </p>
      <details className="directory-example">
        <summary>请求示例</summary>
        <HelpNote label="请求文件格式">
          稳定文件只识别此目录直接包含的 *.rainfall-request.json，稳定窗口为 2
          秒。请求包只识别直接子目录中的 request.json 和最后写入的
          READY.json，不继续递归。请求编号仅使用 ASCII
          字母、数字、点、下划线或连字符，不能使用 Windows 保留名。新任务递增
          revision；同编号同版本重复投递不重复启动。模型、预算、凭据与授权均从已保存的计划读取。
        </HelpNote>
        {sample ? (
          <>
            <pre aria-label="已保存计划的请求示例">{sampleText}</pre>
            <div className="directory-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await navigator.clipboard.writeText(sampleText);
                  }, "请求示例已复制。")
                }
              >
                复制请求示例
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  download(
                    source.readiness === "ready-package"
                      ? "request.json"
                      : `${sample.requestId}.rainfall-request.json`,
                    sampleText,
                  )
                }
              >
                下载请求示例
              </button>
              {source.readiness === "ready-package" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const digest = await crypto.subtle.digest(
                        "SHA-256",
                        new TextEncoder().encode(sampleText),
                      );
                      const requestSha256 = Array.from(
                        new Uint8Array(digest),
                        (n) => n.toString(16).padStart(2, "0"),
                      ).join("");
                      download(
                        "READY.json",
                        JSON.stringify(
                          {
                            schemaVersion: 1,
                            requestId: sample.requestId,
                            revision: sample.revision,
                            requestSha256,
                          },
                          null,
                          2,
                        ) + "\n",
                      );
                    })
                  }
                >
                  下载就绪标记
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="directory-note">先绑定并保存计划，再生成请求示例。</p>
        )}
      </details>
    </article>
  );
}

export default function DirectoryTaskSettings({
  results,
}: {
  results: React.ReactNode;
}) {
  const { call, go } = useStudio();
  const [tab, setTab] = useState("tasks"),
    [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const next = await call("directoryTasks.status", {});
    setStatus(next);
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await call("directoryTasks.status", {});
        if (active) {
          setStatus(next);
          setError("");
        }
      } catch {
        if (active) setError("无法读取目录任务，请稍后刷新。");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const choose = async () => {
    setBusy(true);
    setError("");
    try {
      await call("directoryTasks.chooseDirectory", {});
      await refresh();
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };
  const tabs = [
    ["tasks", "任务请求"],
    ["results", "素材 / 生成结果"],
  ];
  return (
    <section className="directory-settings" aria-label="目录与收件">
      <div role="tablist" aria-label="目录入口" className="directory-tabs">
        {tabs.map(([id, title]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`directory-tab-${id}`}
            aria-controls={`directory-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "tasks"
                    : event.key === "End"
                      ? "results"
                      : tab === "tasks"
                        ? "results"
                        : "tasks";
                setTab(next);
                document.getElementById(`directory-tab-${next}`)?.focus();
              }
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`directory-panel-${tab}`}
        aria-labelledby={`directory-tab-${tab}`}
      >
        {tab === "results" ? (
          results
        ) : (
          <>
            <div className="directory-heading">
              <div>
                <h2>目录任务</h2>
                <p className="directory-note">
                  选择目录，绑定计划，再启用扫描。
                </p>
              </div>
              <div className="directory-actions">
                <button
                  type="button"
                  disabled={busy || !status}
                  onClick={() => void choose()}
                >
                  添加任务目录
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void refresh()
                      .then(() => setError(""))
                      .catch(() => setError("刷新失败，请稍后重试。"))
                  }
                >
                  刷新目录状态
                </button>
              </div>
            </div>
            <HelpNote label="接收范围">
              默认每 10
              秒检查一次，仅在客户端运行时扫描。目录只接收任务请求；音频、图片和生成结果请使用独立的素材入口。目录由原生选择器授权，客户端不会移动或删除其中的用户文件。
            </HelpNote>
            {error && (
              <p className="directory-error" role="alert">
                {error}
              </p>
            )}
            {!status && !error && <p role="status">正在读取目录任务…</p>}
            {status?.sources.length === 0 && (
              <div className="directory-empty">
                <p>还没有任务目录。</p>
                <button type="button" onClick={() => go("plans")}>
                  先准备一个计划
                </button>
              </div>
            )}
            {status?.sources.map((source) => (
              <DirectorySourceCard
                key={source.id}
                source={source}
                plans={status.plans}
                refresh={refresh}
              />
            ))}
            {!!status?.requests.length && (
              <section className="directory-history" aria-label="目录请求队列">
                <h3>请求与运行</h3>
                <div className="directory-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>目录</th>
                        <th>请求编号</th>
                        <th>请求版本</th>
                        <th>状态</th>
                        <th>运行</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.requests
                        .slice(-30)
                        .reverse()
                        .map((entry) => (
                          <tr key={entry.id}>
                            <td
                              title={
                                status.sources.find(
                                  (source) => source.id === entry.sourceId,
                                )?.root
                              }
                            >
                              {status.sources
                                .find((source) => source.id === entry.sourceId)
                                ?.root.split(/[\\/]/)
                                .filter(Boolean)
                                .at(-1) ?? "来源不可用"}
                            </td>
                            <td>
                              <code>{entry.request.requestId}</code>
                            </td>
                            <td>v{entry.request.revision}</td>
                            <td>
                              {stateNames[entry.state] ?? entry.state}
                              {entry.error && (
                                <span className="directory-row-error">
                                  {errorText(entry.error)}
                                </span>
                              )}
                            </td>
                            <td>
                              {entry.runId ? (
                                <button
                                  type="button"
                                  title={entry.runId}
                                  onClick={() => go("plans", entry.runId)}
                                >
                                  查看运行
                                </button>
                              ) : (
                                "尚未分配"
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {!!status?.errors.length && (
              <details className="directory-history">
                <summary>接收错误（{status.errors.length}）</summary>
                <ul className="directory-error-list">
                  {status.errors
                    .slice(-20)
                    .reverse()
                    .map((item, i) => (
                      <li key={item.id ?? i}>
                        <strong>{item.file ?? "目录检查"}</strong>
                        <span>{errorText(item.code)}</span>
                        <HelpNote label="错误详情">
                          {item.code}
                          {item.at ? ` · ${time(item.at)}` : ""}
                        </HelpNote>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
