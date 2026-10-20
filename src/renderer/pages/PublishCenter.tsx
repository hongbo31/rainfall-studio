import {fanqieCapabilities} from '../../shared/fanqie';
import React, { useEffect, useRef, useState } from "react";
import { useStudio, PageHead, Badge, names, label } from "../context";
import HelpHint from "../components/HelpHint";
import PublicationPipelineProgress from "../components/PublicationPipelineProgress";
import PublicationMaterialResult from "../components/PublicationMaterialResult";
import {
  platformTargets,
  type PlatformTarget,
  type PublishSelection,
  type SimplePublicationRequest,
  type PublicationPendingTerms,
} from "../../shared/platform-config";

const states: Record<string, string> = {
  needs_configuration: "待配置",
  needs_materials: "待补材料",
  awaiting_terms_review: "待条款确认",
  unavailable: "未接通",
  ready: "模拟就绪",
};
export default function PublishCenter() {
  const {
    data,
    selected,
    setSelected,
    publishSelection,
    setPublishSelection,
    flushPublishSelection,
    call,
    refresh,
    go,
  } = useStudio();
  const [fallback, setFallback] = useState<PublishSelection>(
    () =>
      data.publishSelection ?? {
        workIds: selected ?? [],
        targets: [],
        accountOverrides: {},
      },
  );
  const selection = publishSelection ?? fallback;
  const [query, setQuery] = useState(""),
    [queueTaskId,setQueueTaskId]=useState(''),
    [queueAccountId,setQueueAccountId]=useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const [currentResult, setCurrentResult] = useState<{
    requests: SimplePublicationRequest[];
    reused: boolean;
    pipeline?: any[];
  } | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const currentScope = JSON.stringify({ mode: data.mode, selection });
  const scopeRef = useRef(currentScope);
  scopeRef.current = currentScope;
  useEffect(() => {
    if (currentResult) {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [currentResult]);
  useEffect(() => {
    setQueueTaskId('');
    setQueueAccountId('');
    setCurrentResult(null);
    setError("");
    setMessage("");
  }, [data.mode]);
  const configurations = data.platformConfigurations ?? [];
  const save = (next: PublishSelection) => {
    setFallback(next);
    setError("");
    setMessage("");
    setCurrentResult(null);
    if (setPublishSelection) return setPublishSelection(next);
    setSelected?.(next.workIds);
    return call("publish.selection.save", next);
  };
  const change = (next: PublishSelection) => {
    void save(next).catch((e: Error) => setError(e.message));
  };
  const configure = async (target: PlatformTarget) => {
    try {
      await flushPublishSelection?.();
      go("accounts", target);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const publish = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setCurrentResult(null);
    const submittedScope = currentScope;
    try {
      await save(selection);
      const result = await call("publish.simple", selection);
      if (scopeRef.current !== submittedScope) return;
      setCurrentResult({
        requests: result.requests ?? [],
        reused: result.reused,
        pipeline: result.pipeline,
      });
      setMessage(
        result.pipeline?.length
          ? "发布任务已更新"
          : result.reused
            ? "已重新核验"
            : "已整理发布材料",
      );
    } catch (e: any) {
      if (scopeRef.current === submittedScope)
        setError(
          "材料准备失败：" + (e instanceof Error ? e.message : "请重试"),
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const allRequests: SimplePublicationRequest[] =
    data.publicationRequests ?? [];
  const inlineRequests =
    currentResult?.requests.map(
      (request) =>
        allRequests.find((latest) => latest.id === request.id) ?? {
          ...request,
          stale: true,
        },
    ) ?? [];
  const inlineStale = inlineRequests.some((request) => request.stale);
  const requests = allRequests
    .filter(
      (request, index) =>
        !allRequests
          .slice(index + 1)
          .some(
            (other) =>
              other.workId === request.workId &&
              other.target === request.target,
          ),
    )
    .reverse();
  const termCards = new Map<
    string,
    { id: string; title: string; platformLabel: string; termsText: string }
  >();
  for (const term of (data.publicationPendingTerms ??
    []) as PublicationPendingTerms[])
    termCards.set(term.id, term);
  for (const request of requests) {
    const terms = request.materialSnapshot?.terms;
    if (terms && !termCards.has(terms.jobId))
      termCards.set(terms.jobId, {
        id: terms.jobId,
        title: request.title,
        platformLabel: names[request.target],
        termsText: terms.termsText,
      });
  }
  const pendingTerms = [...termCards.values()];
  const pipelineJobs = new Map<string, any>();
  for (const job of currentResult?.pipeline ?? [])
    pipelineJobs.set(job.id, job);
  for (const job of data.publicationPipelineJobs ?? [])
    pipelineJobs.set(job.id, job);
  const queuedJobs=[...pipelineJobs.values()];
  const pipeline = queuedJobs.filter((job:any)=>(!queueTaskId||job.id===queueTaskId)&&(!queueAccountId||job.accountId===queueAccountId));
  const activePipeline = queuedJobs.some((job: any) =>
    ["queued", "preparing", "awaiting_authorization"].includes(job.state),
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!activePipeline) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refreshRef.current?.();
      } catch {
        /* Keep the persisted progress visible; never replay publication. */
      }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activePipeline]);
  return (
    <div className="simple-publishing">
      <PageHead title="发布中心" />
      {!fanqieCapabilities.upload && <p role="status">番茄音乐：已核对第一步表单，尚不可自动上传或提交。</p>}
      <section className="panel publish-choices" aria-label="选择歌曲和平台">
        <fieldset
          className="simple-publish-grid publish-selection-fields"
          disabled={busy}
        >
          <div className="song-choice">
            <div className="section-title">
              <h2>1 · 选择歌曲</h2>
              <Badge>{selection.workIds.length} 首已选</Badge>
            </div>
            <label>
              搜索歌曲
              <input
                type="search"
                aria-label="搜索歌曲"
                placeholder="输入歌名"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="simple-song-list">
              {data.works
                .filter((work: any) =>
                  work.title
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                )
                .map((work: any) => (
                  <label
                    className={
                      "simple-song" +
                      (selection.workIds.includes(work.id)
                        ? " is-selected"
                        : "")
                    }
                    key={work.id}
                  >
                    <input
                      type="checkbox"
                      aria-label={"选择歌曲：" + work.title}
                      checked={selection.workIds.includes(work.id)}
                      onChange={() =>
                        change({
                          ...selection,
                          workIds: selection.workIds.includes(work.id)
                            ? selection.workIds.filter((id) => id !== work.id)
                            : [...selection.workIds, work.id],
                        })
                      }
                    />
                    <span>
                      <b>{work.title}</b>
                      <small>
                        {data.artists.find(
                          (artist: any) => artist.id === work.artistId,
                        )?.name ?? "未设艺人"}{" "}
                        · {work.assets?.audio_A ? "音频 A" : "缺少音频 A"}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
            {!data.works.length && (
              <button onClick={() => go("create")}>去创作</button>
            )}
          </div>
          <div className="target-choice">
            <h2>2 · 选择平台</h2>
            <div className="simple-target-list">
              {platformTargets.map((target) => {
                const config = configurations.find(
                  (item: any) => item.target === target,
                );
                const accounts = data.accounts.filter(
                  (account: any) =>
                    account.provider === target ||
                    (["qqmusic", "kugou"].includes(target) &&
                      account.provider === "tme"),
                );
                const chosen = selection.targets.includes(target);
                const accountId =
                  selection.accountOverrides[target] ?? config?.accountId ?? "";
                return (
                  <article
                    className={"simple-target" + (chosen ? " is-selected" : "")}
                    key={target}
                  >
                    <div className="simple-target-heading">
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          aria-label={"发布到 " + names[target]}
                          checked={chosen}
                          onChange={() =>
                            change({
                              ...selection,
                              targets: chosen
                                ? selection.targets.filter(
                                    (item) => item !== target,
                                  )
                                : [...selection.targets, target],
                            })
                          }
                        />
                        <b>{names[target]}</b>
                      </label>
                      <HelpHint label="平台说明">
                        {target === "douyin"
                          ? "使用作品已有视频。"
                          : "使用原音频 A、已选封面和已有歌词。"}
                        正式提交前需逐首确认当前条款。
                      </HelpHint>
                    </div>
                    <div className="simple-target-meta">
                      <span>
                        {data.mode === "simulation"
                          ? "模拟"
                          : ["qqmusic", "kugou"].includes(target)
                            ? "腾讯 AI 投稿"
                            : "未接通"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => void configure(target)}
                      >
                        {"配置 " + names[target]}
                      </button>
                    </div>
                    {chosen &&
                      (accounts.length ? (
                        <label className="target-account">
                          发布账号
                          <select
                            aria-label={names[target] + "发布账号"}
                            value={accountId}
                            onChange={(event) => {
                              const accountOverrides = {
                                ...selection.accountOverrides,
                              };
                              if (event.target.value)
                                accountOverrides[target] = event.target.value;
                              else delete accountOverrides[target];
                              change({ ...selection, accountOverrides });
                            }}
                          >
                            <option value="">请选择账号</option>
                            {accounts.map((account: any) => (
                              <option key={account.id} value={account.id}>
                                {account.name} ·{" "}
                                {label(account.authStatus ?? "not_connected")}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <small className="configuration-missing">
                          缺少账号
                        </small>
                      ))}
                  </article>
                );
              })}
            </div>
          </div>
        </fieldset>
        <div className="simple-publish-action">
          <h2>3 · 发布</h2>
          <button
            className="primary"
            disabled={
              busy || !selection.workIds.length || !selection.targets.length
            }
            onClick={() => void publish()}
          >
            {busy
              ? "正在准备材料…"
              : error
                ? "重试准备"
                : data.mode === "simulation"
                  ? "发布（模拟）"
                  : "发布"}
          </button>
          <HelpHint label="发布说明">
            检查材料并准备投稿；遇到授权或条款确认时暂停。
          </HelpHint>
          {message && (
            <span role="status">
              {inlineStale ? "资料已变化，请重新检查" : message}
            </span>
          )}
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>
        {currentResult && !queuedJobs.length && (
          <section
            className="publication-current-result"
            ref={resultRef}
            tabIndex={-1}
            role="region"
            aria-label="本次发布材料"
            aria-busy="false"
          >
            <div className="section-title">
              <h2>本次发布材料</h2>
              <span>
                {inlineStale
                  ? "待重新检查"
                  : currentResult.reused
                    ? "已重新核验"
                    : "已整理"}{" "}
                · 未上传
              </span>
            </div>
            {inlineStale && (
              <button disabled={busy} onClick={() => void publish()}>
                重新检查
              </button>
            )}
            {inlineRequests.map((request) => (
              <PublicationMaterialResult
                key={request.id}
                request={request}
                onTrack={() => go("track", request.workId)}
                onConfigure={() => void configure(request.configurationTarget)}
              />
            ))}
          </section>
        )}
      </section>
      {!!queuedJobs.length&&<section className="publication-queue-filters" aria-label="发布队列筛选">
        <label>发布任务<select data-testid="publication-task-filter" value={queueTaskId} onChange={event=>setQueueTaskId(event.target.value)}><option value="">全部任务</option>{queuedJobs.map((job:any)=><option key={job.id} value={job.id}>{job.title} · {(data.accounts??[]).find((account:any)=>account.id===job.accountId)?.name??'未指定账号'}</option>)}</select></label>
        <label>发布账号<select data-testid="publication-account-filter" value={queueAccountId} onChange={event=>setQueueAccountId(event.target.value)}><option value="">全部账号</option>{[...new Set<string>(queuedJobs.map((job:any)=>job.accountId).filter(Boolean))].map(id=><option key={id} value={id}>{(data.accounts??[]).find((account:any)=>account.id===id)?.name??'账号待核对'}</option>)}</select></label>
      </section>}
      {!!pipeline.length && (
        <PublicationPipelineProgress
          jobs={pipeline}
          data={data}
          onRefresh={refresh}
          onReconcile={(id) => call("publish.reconcile", {id})}
          onTrack={(id) => go("track", id)}
          onConfigure={(target) => void configure(target)}
        />
      )}
      {!!queuedJobs.length&&!pipeline.length&&<p role="status">没有符合筛选的发布任务。</p>}
      {!queuedJobs.length && (requests.length > 0 || pendingTerms.length > 0) && (
        <section className="panel simple-request-list" aria-label="发布任务">
          <h2>发布任务</h2>
          {pendingTerms.map((term) => (
            <article className="simple-request" key={"terms-" + term.id}>
              <div className="simple-request-heading">
                <b>
                  {term.title} · {term.platformLabel}
                </b>
                <Badge>待条款确认 · 未接受条款</Badge>
              </div>
              <details>
                <summary>查看条款</summary>
                <pre>{term.termsText}</pre>
              </details>
            </article>
          ))}
          {requests.map((request) => (
            <article
              className="simple-request"
              key={request.id}
              data-request-id={request.id}
            >
              <div className="simple-request-heading">
                <b>
                  {request.title} · {names[request.target]}
                </b>
                <Badge>
                  {request.stale
                    ? "资料已变化 · 请重新检查"
                    : request.state === "ready" &&
                        request.source !== "simulation"
                      ? "未接通"
                      : (states[request.state] ?? request.summary)}
                </Badge>
              </div>
              <div className="simple-request-meta">
                <small>
                  {request.source === "simulation" ? "模拟" : "本地检查"} ·{" "}
                  {request.summary}
                </small>
                <button
                  className="text-button"
                  onClick={() => void configure(request.configurationTarget)}
                >
                  {"配置 " + names[request.configurationTarget]}
                </button>
              </div>
              {!!request.issues.length && (
                <details>
                  <summary>查看问题</summary>
                  <ul>
                    {request.issues.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                  <button onClick={() => go("track", request.workId)}>
                    查看素材
                  </button>
                </details>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
