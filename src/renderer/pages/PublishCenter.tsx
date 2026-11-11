import FanqieCatalogPanel from '../components/FanqieCatalogPanel';
import PublicationMusicList from "../components/PublicationMusicList";
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
    [queueTaskId, setQueueTaskId] = useState(""),
    [queueAccountId, setQueueAccountId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const [fanqieState,setFanqieState]=useState<any>(null),[fanqieConfigured,setFanqieConfigured]=useState(false);
  const [channelResults,setChannelResults]=useState<string[]>([]);
  useEffect(()=>{let active=true;setFanqieState(null);setFanqieConfigured(false);if(data.mode==='production'&&window.rainfall?.fanqieUpload){
    void window.rainfall.fanqieUpload('status').then(r=>{if(active&&r.ok)setFanqieState(r.value)}).catch(()=>{});
    void window.rainfall.fanqieUpload('configuration').then(r=>{if(active&&r.ok)setFanqieConfigured(!!r.value.configuration)}).catch(()=>{});
  }return()=>{active=false};},[data.mode]);
  useEffect(()=>{if(!busy||!selection.targets.includes('fanqie'))return;let active=true;const timer=setInterval(()=>{void window.rainfall.fanqieCatalog('status').then(r=>{if(active&&r.ok&&r.value.progress)setMessage('番茄音乐：'+r.value.progress)}).catch(()=>{});},1200);return()=>{active=false;clearInterval(timer)};},[busy,data.mode]);
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
    setQueueTaskId("");
    setQueueAccountId("");
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
    setChannelResults([]);
    const submittedScope = currentScope;
    try {
      await save(selection);
      if(selection.targets.includes('fanqie')){
        if(data.mode!=='production')throw Error('番茄音乐暂不提供模拟发布');
        const config=await window.rainfall.fanqieUpload('configuration');
        if(!config.ok)throw Error(config.error.message);
        if(!config.value.configuration)throw Error('请先在配置中心保存番茄音乐设置');
        const items=selection.workIds.map(workId=>{const work=data.works.find((w:any)=>w.id===workId);if(!work)throw Error('作品已变化，请重新选择');return {workId,variant:work.selectedAudioVariant==='B'?'B':'A'};});
        const uploaded=await window.rainfall.fanqieUpload('publishBatch',{items});
        if(!uploaded.ok)throw Error(uploaded.error.message);
        if(scopeRef.current!==submittedScope)return;
        setFanqieState(uploaded.value);
        const batch=uploaded.value.batch;
        setChannelResults(batch.items.filter((i:any)=>i.state==='complete').map((i:any)=>{const outcome=i.result?.result;const title=data.works.find((w:any)=>w.id===i.workId)?.title??'作品';return title+' · 番茄音乐 · '+(i.result?.authorization?.[0]?.status??(outcome?.uploaded?outcome.officialRecord.officialStatus:'官网已有同名作品，已跳过上传'));}));
        if(batch.state!=='complete')throw Error('本批已暂停，已完成作品保留；请查看发布记录后继续');
      }
      const otherTargets=selection.targets.filter(t=>t!=='fanqie');
      if(!otherTargets.length){setMessage('番茄处理完成，请查看发布记录');return;}
      const result = await call("publish.simple", {...selection,targets:otherTargets});
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
          "发布未完成：" + (e instanceof Error ? e.message : "请重试"),
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
  const queuedJobs = [...pipelineJobs.values()];
  const pipeline = queuedJobs.filter(
    (job: any) =>
      (!queueTaskId || job.id === queueTaskId) &&
      (!queueAccountId || job.accountId === queueAccountId),
  );
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
            <PublicationMusicList
              selection={selection}
              onChange={change}
              query={query}
              busy={busy}
              onVersionBusy={setBusy}
            />
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
                          disabled={
                            target==='fanqie'?data.mode!=='production':data.mode !== "simulation" &&
                            !["qqmusic", "kugou"].includes(target)
                          }
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
                          : "使用所选音频版本、已选封面和已有歌词。"}
                        {target==='fanqie'?'自动上传至待授权，合同在官网处理。':'正式提交前需逐首确认当前条款。'}
                      </HelpHint>
                    </div>
                    <div className="simple-target-meta">
                      <span>
                        {target==='fanqie'?(fanqieConfigured?'已配置 · 自动上传':'待配置'):data.mode === "simulation"
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
                    {chosen && target!=='fanqie' &&
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
              busy ||
              !selection.workIds.length ||
              !selection.targets.length ||
              (data.mode !== "simulation" &&
                selection.targets.some(
                  (target) => !["fanqie", "qqmusic", "kugou"].includes(target),
                ))
            }
            onClick={() => void publish()}
          >
            {busy
              ? "正在发布…"
              : error
                ? "重新发布"
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
        {channelResults.map((text,index)=><p role="status" key={index}>{text}</p>)}
        {fanqieState?.batch&&<section className="publication-current-result" aria-label="番茄批次"><h3>番茄批次</h3><p>{fanqieState.batch.items.filter((i:any)=>i.state==='complete').length}/{fanqieState.batch.items.length} 首已处理 · {fanqieState.batch.state==='complete'?'处理完成':fanqieState.batch.state==='paused'?'已暂停':'处理中'}</p>{fanqieState.batch.state==='paused'&&<button disabled={busy} onClick={async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{const r=await window.rainfall.fanqieUpload('publishBatch',{items:fanqieState.batch.items.map(({workId,variant}:any)=>({workId,variant})),resume:true});if(!r.ok)throw Error(r.error.message);setFanqieState(r.value);if(r.value.batch.state==='paused')setError('仍有作品待核对，已完成作品保留。');}catch(e:any){setError(e.message)}finally{inFlight.current=false;setBusy(false)}}}>核对后继续批次</button>}</section>}
        <details><summary>番茄账号与已有作品</summary><FanqieCatalogPanel mode={data.mode}/></details>
        {!!fanqieState?.jobs?.length&&<section className="publication-current-result" aria-label="番茄发布记录"><h3>发布记录</h3>{fanqieState.jobs.map((job:any)=><div className="publication-channel-result" key={job.id}><span><b>{job.title}</b> · 番茄音乐 · {job.officialRecord?.officialStatus??(job.phase==='unknown'?'待核对':'处理中')}{job.officialRecord&&` · ${job.officialRecord.id}`}</span><button disabled={busy} onClick={async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);try{const r=await window.rainfall.fanqieUpload('reconcile',{id:job.id});if(!r.ok)throw Error(r.error.message);setFanqieState(r.value);}catch(e:any){setError(e.message)}finally{inFlight.current=false;setBusy(false)}}}>更新状态</button></div>)}</section>}
        {currentResult && (
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
      {!!queuedJobs.length && (
        <section
          className="publication-queue-filters"
          aria-label="发布队列筛选"
        >
          <label>
            发布任务
            <select
              data-testid="publication-task-filter"
              value={queueTaskId}
              onChange={(event) => setQueueTaskId(event.target.value)}
            >
              <option value="">全部任务</option>
              {queuedJobs.map((job: any) => (
                <option key={job.id} value={job.id}>
                  {job.title} ·{" "}
                  {(data.accounts ?? []).find(
                    (account: any) => account.id === job.accountId,
                  )?.name ?? "未指定账号"}
                </option>
              ))}
            </select>
          </label>
          <label>
            发布账号
            <select
              data-testid="publication-account-filter"
              value={queueAccountId}
              onChange={(event) => setQueueAccountId(event.target.value)}
            >
              <option value="">全部账号</option>
              {[
                ...new Set<string>(
                  queuedJobs.map((job: any) => job.accountId).filter(Boolean),
                ),
              ].map((id) => (
                <option key={id} value={id}>
                  {(data.accounts ?? []).find(
                    (account: any) => account.id === id,
                  )?.name ?? "账号待核对"}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {!!pipeline.length && (
        <PublicationPipelineProgress
          jobs={pipeline}
          data={data}
          onRefresh={refresh}
          onReconcile={(id) => call("publish.reconcile", { id })}
          onTrack={(id) => go("track", id)}
          onConfigure={(target) => void configure(target)}
        />
      )}
      {!!queuedJobs.length && !pipeline.length && (
        <p role="status">没有符合筛选的发布任务。</p>
      )}
      {(requests.length > 0 || pendingTerms.length > 0) && (
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
