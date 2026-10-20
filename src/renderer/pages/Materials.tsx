import React, { useEffect, useRef, useState } from "react";
import { useStudio, PageHead, Badge } from "../context";
import HelpNote from "../components/HelpNote";
import type { ApiProfile } from "../../shared/api-profiles";
import type {
  MaterialEntry,
  MaterialEnqueueInput,
  MaterialWorkbenchSnapshot,
} from "../../shared/material-workbench";
import "../material-workbench.css";

const stateNames: Record<string, string> = {
  pending: "待生成",
  invalid: "材料不完整",
  missing: "源文件缺失",
  queued: "排队中",
  generating: "生成中",
  generated: "已生成",
  failed: "失败",
  unknown: "结果待核对",
  blocked: "已阻止",
  dispatching: "提交中",
  accepted: "已受理",
  polling: "等待生成",
  downloading: "下载校验中",
  completed: "音频已验证",
};
const canGenerate = (m: MaterialEntry) => m.state === "pending";
export default function Materials() {
  const { call, data, go } = useStudio();
  const [snapshot, setSnapshot] = useState<MaterialWorkbenchSnapshot | null>(
    null,
  );
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [sourceId, setSourceId] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState("pending"),
    [query, setQuery] = useState(""),
    [detailId, setDetailId] = useState("");
  const [profileId, setProfileId] = useState(""),
    [artistId, setArtistId] = useState(""),
    [modelId, setModelId] = useState("");
  const [budget, setBudget] = useState(""),
    [consent, setConsent] = useState(false),
    [regenerateId, setRegenerateId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    if (!detailId) return;
    const origin = document.activeElement as HTMLElement | null;
    return () => origin?.focus();
  }, [detailId]);
  const reload = async () => {
    const next: MaterialWorkbenchSnapshot = await call("materials.list", {});
    if (!mounted.current) return;
    // Only a verified generated state removes a stable ID. Filter/rescan never truncates selection.
    setSnapshot(next);
    setSelected((ids) =>
      ids.filter(
        (id) =>
          !next.materials.some((m) => m.id === id && m.state === "generated"),
      ),
    );
    setSourceId((id) =>
      next.sources.some((s) => s.id === id) ? id : (next.sources[0]?.id ?? ""),
    );
  };
  useEffect(() => {
    mounted.current = true;
    void reload().catch((e) => mounted.current && setError(e.message));
    void call("apiProfile.list", {})
      .then((result: ApiProfile[]) => {
        if (mounted.current)
          setProfiles(result.filter((p) => p.kind === "music"));
      })
      .catch((e) => mounted.current && setError(e.message));
    const timer = setInterval(() => {
      if (!inFlight.current)
        void reload().catch((e) => mounted.current && setError(e.message));
    }, 3000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [call]);
  const run = async (action: () => Promise<unknown>, success = "") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await reload();
      if (mounted.current) setMessage(success);
    } catch (e: any) {
      if (mounted.current) setError(e.message || "操作失败");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const artists = data.artists ?? [];
  const profile = profiles.find((p) => p.id === profileId);
  const materials = snapshot?.materials ?? [],
    jobs = snapshot?.jobs ?? [];
  const visible = materials.filter(
    (m) =>
      (scope === "all" ||
        (scope === "generated"
          ? m.state === "generated"
          : m.state !== "generated")) &&
      (!sourceId || m.sourceId === sourceId) &&
      [m.number, m.title, m.lyrics, m.style]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const chosen = materials.filter((m) => selected.includes(m.id));
  const detail = materials.find((m) => m.id === detailId);
  const generationReady =
    !!snapshot?.generationCapability.available &&
    !!profile &&
    !!modelId.trim() &&
    !!artistId &&
    Number.isFinite(Number(budget)) &&
    Number(budget) > 0 &&
    consent &&
    !busy;
  const enqueue = async (ids: string[], regenerate = false) => {
    if (!generationReady || !profile) return;
    const input: MaterialEnqueueInput = {
      materialIds: ids,
      expectedRevisions: Object.fromEntries(
        materials
          .filter((m) => ids.includes(m.id))
          .map((m) => [m.id, m.revision]),
      ),
      requestId: crypto.randomUUID(),
      profileId: profile.id,
      profileRevision: profile.revision,
      modelId: modelId.trim(),
      artistId,
      budgetCredits: Number(budget),
      consent: true,
      ...(regenerate ? { regenerate: true } : {}),
    };
    await run(() => call("materials.enqueue", input), "已加入生成队列");
    setRegenerateId("");
  };
  const toggle = (id: string, checked: boolean) =>
    setSelected((ids) =>
      checked ? Array.from(new Set([...ids, id])) : ids.filter((v) => v !== id),
    );
  return (
    <main className="material-workbench">
      <PageHead
        title="素材工作台"
        sub="选择目录后手动扫描；完成的音频可前往现有发布中心。"
        action={<button onClick={() => go("publish")}>前往发布中心</button>}
      />
      {error && (
        <div role="alert" className="material-error">
          {error}
        </div>
      )}
      {message && <div role="status">{message}</div>}
      <section className="panel material-source" aria-label="素材来源">
        <div className="material-toolbar">
          <h2>素材目录</h2>
          <HelpNote label="扫描说明">
            选择目录仅保存来源配置。扫描读取歌词、编号 Style
            和封面，不改写源文件。扫描时目录控件暂时只读。
          </HelpNote>
        </div>
        <div className="material-toolbar">
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () => call("materials.chooseDirectory", {}),
                "目录已配置，请点击扫描目录",
              )
            }
          >
            选择素材目录
          </button>
          <label>
            扫描来源
            <select
              aria-label="扫描来源"
              disabled={busy}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="" disabled>
                请选择目录
              </option>
              {snapshot?.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.root}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !sourceId}
            onClick={() =>
              void run(() => call("materials.scan", { sourceId }), "扫描完成")
            }
          >
            扫描目录
          </button>
          <button
            disabled={busy}
            onClick={() => void run(async () => {}, "状态已刷新")}
          >
            刷新状态
          </button>
        </div>
        {snapshot?.sources
          .filter((s) => s.id === sourceId)
          .map((s) => (
            <div className="material-source-meta" key={s.id}>
              <span>{s.root}</span>
              <Badge>修订 {s.revision}</Badge>
              {s.lastScanAt && (
                <time>{new Date(s.lastScanAt).toLocaleString()}</time>
              )}
              {s.error && <span role="alert">{s.error}</span>}
            </div>
          ))}
      </section>
      <section className="panel" aria-label="素材列表">
        <div className="material-toolbar">
          <h2>
            素材{" "}
            <small>
              {visible.length} / {materials.length}
            </small>
          </h2>
          <label>
            搜索
            <input
              aria-label="搜索素材"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="编号、标题、歌词或 Style"
            />
          </label>
          <label>
            显示
            <select
              aria-label="显示范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="pending">待处理</option>
              <option value="all">全部素材</option>
              <option value="generated">已生成</option>
            </select>
          </label>
        </div>
        <div className="material-toolbar">
          <label>
            <input
              type="checkbox"
              aria-label="选择当前可生成素材"
              disabled={busy || !visible.some(canGenerate)}
              checked={
                visible.some(canGenerate) &&
                visible
                  .filter(canGenerate)
                  .every((m) => selected.includes(m.id))
              }
              onChange={(e) => {
                const ids = visible.filter(canGenerate).map((m) => m.id);
                setSelected((old) =>
                  e.target.checked
                    ? Array.from(new Set([...old, ...ids]))
                    : old.filter((id) => !ids.includes(id)),
                );
              }}
            />
            选择当前可生成素材
          </label>
          <span role="status">已选 {selected.length}</span>
          <button disabled={!selected.length} onClick={() => setSelected([])}>
            清空选择
          </button>
        </div>
        <div className="material-table-wrap">
          <table className="material-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>编号 / 标题</th>
                <th>歌词</th>
                <th>Style</th>
                <th>封面</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"选择 " + m.title}
                      checked={selected.includes(m.id)}
                      disabled={busy || !canGenerate(m)}
                      onChange={(e) => toggle(m.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <small>{m.number}</small>
                    <button
                      className="material-title"
                      onClick={() => setDetailId(m.id)}
                    >
                      {m.title}
                    </button>
                    <small>修订 {m.revision}</small>
                  </td>
                  <td>
                    <Badge tone={m.checks.lyrics.valid ? "ok" : "warn"}>
                      {m.checks.lyrics.valid ? "已校验" : "待处理"}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={m.checks.style.valid ? "ok" : "warn"}>
                      {m.checks.style.valid ? "已校验" : "待处理"}
                    </Badge>
                  </td>
                  <td>
                    {m.cover.previewUrl && (
                      <button
                        className="material-cover-button"
                        aria-label={"查看 " + m.title + " 封面"}
                        onClick={() => setDetailId(m.id)}
                      >
                        <img
                          className="material-thumb"
                          src={m.cover.previewUrl}
                          alt={m.title + " 封面"}
                        />
                      </button>
                    )}
                    <Badge tone={m.checks.cover.valid ? "ok" : "warn"}>
                      {m.checks.cover.valid
                        ? `${m.cover.width} × ${m.cover.height}`
                        : "待处理"}
                    </Badge>
                  </td>
                  <td>
                    <Badge
                      tone={
                        [
                          "failed",
                          "unknown",
                          "invalid",
                          "blocked",
                          "missing",
                        ].includes(m.state)
                          ? "warn"
                          : ""
                      }
                    >
                      {stateNames[m.state] ?? m.state}
                    </Badge>
                    {m.validationReasons.length > 0 && (
                      <small>{m.validationReasons.join("；")}</small>
                    )}
                  </td>
                  <td>
                    <button onClick={() => setDetailId(m.id)}>详情</button>
                    {canGenerate(m) && (
                      <button
                        disabled={!generationReady}
                        onClick={() => void enqueue([m.id])}
                      >
                        生成
                      </button>
                    )}
                    {m.state === "generated" && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setDetailId(m.id);
                          setRegenerateId(m.id);
                        }}
                      >
                        重新生成
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!snapshot ? (
          <p role="status">正在读取素材…</p>
        ) : (
          !visible.length && <p>此范围暂无素材</p>
        )}
      </section>
      <section className="panel" aria-label="生成设置">
        <div className="material-toolbar">
          <h2>生成设置</h2>
          <HelpNote label="费用与生成说明">
            按编号顺序排队，每次仅处理一个完整生成任务。预算包含已预留和未知结果费用；本地预算不是供应商的收费上限。暂停不会撤回已提交请求。只有原任务音频下载并校验后才标为已生成。
          </HelpNote>
        </div>
        <div className="material-settings">
          <label>
            艺人
            <select
              aria-label="生成艺人"
              value={artistId}
              disabled={busy}
              onChange={(e) => setArtistId(e.target.value)}
            >
              <option value="">请选择艺人</option>
              {artists.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            音乐 API 配置
            <select
              aria-label="音乐 API 配置"
              value={profileId}
              disabled={busy}
              onChange={(e) => {
                setProfileId(e.target.value);
                setModelId(
                  profiles.find((p) => p.id === e.target.value)?.modelId ?? "",
                );
                setConsent(false);
              }}
            >
              <option value="">请选择配置</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · 修订 {p.revision}
                </option>
              ))}
            </select>
          </label>
          <label>
            模型
            <input
              aria-label="生成模型"
              value={modelId}
              disabled={busy}
              onChange={(e) => {
                setModelId(e.target.value);
                setConsent(false);
              }}
            />
          </label>
          <label>
            预算额度
            <input
              aria-label="预算额度"
              type="number"
              min="0"
              step="any"
              value={budget}
              disabled={busy}
              onChange={(e) => {
                setBudget(e.target.value);
                setConsent(false);
              }}
            />
          </label>
        </div>
        <label className="material-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          我确认按所选配置和预算执行付费生成
        </label>
        {snapshot && !snapshot.generationCapability.available && (
          <p className="material-block" role="status">
            生成暂不可用：
            {snapshot.generationCapability.reason || "费用上限未核实"}
          </p>
        )}
        <div className="material-toolbar">
          <button
            disabled={
              !generationReady ||
              !chosen.length ||
              chosen.some((m) => !canGenerate(m))
            }
            onClick={() => void enqueue(chosen.map((m) => m.id))}
          >
            加入生成队列
          </button>
          <span>
            已预留 {snapshot?.budget.reserved ?? "—"} · 已用{" "}
            {snapshot?.budget.spent ?? "—"}
            {snapshot?.budget.unknown ? " · 含待核对费用" : ""}
          </span>
        </div>
      </section>
      <section className="panel" aria-label="生成队列">
        <div className="material-toolbar">
          <h2>生成队列</h2>
          <Badge>{snapshot?.paused ? "已暂停" : "运行中"}</Badge>
          <button
            disabled={busy || !snapshot}
            onClick={() =>
              void run(() =>
                call(
                  snapshot?.paused ? "materials.resume" : "materials.pause",
                  {},
                ),
              )
            }
          >
            {snapshot?.paused ? "恢复队列" : "暂停队列"}
          </button>
        </div>
        {!jobs.length && <p>暂无生成任务</p>}
        {jobs.map((j) => (
          <article className="material-job" key={j.id}>
            <div>
              <strong>
                {materials.find((m) => m.id === j.materialId)?.title ??
                  j.materialId}
              </strong>
              <Badge>{stateNames[j.state] ?? j.state}</Badge>
              <small>任务 {j.id}</small>
              {j.reason && <p>{j.reason}</p>}
            </div>
            {j.state === "failed" && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => call("materials.retry", { jobId: j.id }))
                }
              >
                重试任务
              </button>
            )}
            {j.state === "unknown" && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => call("materials.reconcile", { jobId: j.id }))
                }
              >
                核对原任务
              </button>
            )}
          </article>
        ))}
      </section>
      {detail && (
        <div className="material-drawer-backdrop">
          <section
            className="material-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={detail.title + " 素材详情"}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDetailId("");
                setRegenerateId("");
              }
              if (e.key === "Tab") {
                const controls = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),input:not(:disabled),select:not(:disabled),summary",
                  ),
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="material-toolbar">
              <h2>
                {detail.number} · {detail.title}
              </h2>
              <button
                autoFocus
                onClick={() => {
                  setDetailId("");
                  setRegenerateId("");
                }}
              >
                关闭详情
              </button>
            </div>
            <Badge>{stateNames[detail.state]}</Badge>
            {detail.cover.previewUrl && (
              <figure className="material-cover-detail">
                <img
                  className="material-preview"
                  src={detail.cover.previewUrl}
                  alt={detail.title + " 封面预览"}
                />
                <figcaption>
                  <span>
                    {detail.cover.width} × {detail.cover.height}
                  </span>
                  <span>{detail.checks.cover.path}</span>
                  <span>封面修订 {detail.revision}</span>
                  <span>{detail.checks.cover.sha256}</span>
                </figcaption>
              </figure>
            )}
            <h3>歌词</h3>
            <pre>{detail.lyrics || "缺少歌词"}</pre>
            <h3>Style</h3>
            <pre>{detail.style || "缺少 Style"}</pre>
            {detail.styleNotes && (
              <>
                <h3>原始 Style 说明</h3>
                <pre>{detail.styleNotes}</pre>
              </>
            )}
            <details>
              <summary>来源与校验记录</summary>
              <dl>
                <dt>稳定编号</dt>
                <dd>{detail.id}</dd>
                <dt>修订 / 内容哈希</dt>
                <dd>
                  {detail.revision} / {detail.contentHash}
                </dd>
                {Object.entries(detail.checks).map(([kind, c]) => (
                  <React.Fragment key={kind}>
                    <dt>{kind}</dt>
                    <dd>
                      {c.path}
                      <br />
                      {c.exists ? "存在" : "缺失"} ·{" "}
                      {c.valid ? "已校验" : c.reason || "待处理"}
                      <br />
                      {c.sha256}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </details>
            {detail.validationReasons.map((r, i) => (
              <p className="material-error" key={i}>
                {r}
              </p>
            ))}
            <h3>音频版本</h3>
            {!detail.versions.length && <p>暂无已验证音频</p>}
            {detail.versions.map((v) => (
              <label className="material-version" key={v.id}>
                <input
                  type="radio"
                  name="material-version"
                  checked={detail.selectedVersionId === v.id}
                  disabled={busy}
                  onChange={() =>
                    void run(() =>
                      call("materials.selectVersion", {
                        materialId: detail.id,
                        versionId: v.id,
                      }),
                    )
                  }
                />
                版本 {v.version}
                <small>
                  {v.createdAt} · 原任务 {v.jobId}
                </small>
              </label>
            ))}
            {detail.state === "generated" && (
              <button
                disabled={busy}
                onClick={() => setRegenerateId(detail.id)}
              >
                重新生成
              </button>
            )}
            {regenerateId === detail.id && (
              <div
                className="material-regenerate"
                role="group"
                aria-label="确认重新生成"
              >
                <p>将创建新的付费生成尝试，并保留全部旧版本。</p>
                <button
                  disabled={!generationReady}
                  onClick={() => void enqueue([detail.id], true)}
                >
                  确认重新生成
                </button>
                <button onClick={() => setRegenerateId("")}>
                  取消重新生成
                </button>
              </div>
            )}
            {!!detail.versions.length && (
              <button onClick={() => go("publish")}>前往发布中心</button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
