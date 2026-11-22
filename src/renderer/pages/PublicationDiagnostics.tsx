import QuickPublish from "../components/QuickPublish";
import ManualReport from "../components/ManualReport";
import TmeDraftStudio from "../components/TmeDraftStudio";
import TmeObservationReport from "../components/TmeObservationReport";
import TmeAiPrepareWorkspace from "../components/TmeAiPrepareWorkspace";
import HelpNote from "../components/HelpNote";
import React, { useState } from "react";
import { useStudio, PageHead, Badge, names, label, date } from "../context";
export default function PublicationDiagnostics() {
  const [tmeView, setTmeView] = useState(false);
  const { data, call, go, exportArtifact, notify } = useStudio();
  const tmeAccounts = data.accounts.filter((a: any) =>
    ["tme", "qqmusic", "kugou"].includes(a.provider),
  );
  const [observationAccount, setObservationAccount] = useState(
    tmeAccounts.length === 1 ? tmeAccounts[0].id : "",
  );
  const batches = data.batches.filter((b: any) => b.kind !== "tme_uia");
  const [active, setActive] = useState(batches.at(-1)?.id || ""),
    [approval, setApproval] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [showExceptions, setShowExceptions] = useState(false),
    [manualUnit, setManualUnit] = useState<any>(null);
  const batch = batches.find((b: any) => b.id === active);
  const units = data.units.filter(
    (u: any) => u.kind !== "tme_uia" && u.batchId === active,
  );
  if (tmeView)
    return (
      <>
        <PageHead
          title="腾讯作品资料"
          action={
            <button onClick={() => setTmeView(false)}>
              返回发布诊断
            </button>
          }
        />
        <TmeDraftStudio />
      </>
    );
  return (
    <>
      <PageHead
        title="发布诊断"
        action={
          <button onClick={() => setShowExceptions(!showExceptions)}>
            {showExceptions ? "返回批次" : "异常与待处理"}{" "}
            <Badge>{data.exceptions.length}</Badge>
          </button>
        }
      />
      <HelpNote label="发布诊断说明">
        {data.mode === "simulation"
          ? "模拟演练工作区：所有远端回执均为模拟，不会访问或投稿真实平台。"
          : "真实本地工作区：腾讯 AI 作品可按本地授权准备到条款预览；正式提交仍需另行确认。其他平台可准备素材并登记官方进度。"}{" "}
        音频发行与抖音视频投稿分别准备。
      </HelpNote>
      {showExceptions ? (
        <ExceptionList />
      ) : (
        <>
          <TmeAiPrepareWorkspace data={data} notify={notify} />
          <QuickPublish onBatch={setActive} />
          {data.mode === "production" && (
            <details className="panel">
              <summary>腾讯官方页面进度与证据</summary>
              <label>
                关联本地腾讯账户备注
                <select
                  value={observationAccount}
                  onChange={(e) => setObservationAccount(e.target.value)}
                >
                  <option value="">选择账户备注（不代表已授权）</option>
                  {tmeAccounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <TmeObservationReport accountId={observationAccount} />
            </details>
          )}
          <details className="panel quick-advanced">
            <summary>腾讯资料与连接</summary>
            <button onClick={() => setTmeView(true)}>打开逐首资料工具</button>
          </details>
          {batch && (
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>预检批次</h2>
                  <p>
                    批次 {batch.id.slice(0, 8)} · {units.length} 次提交单元 ·{" "}
                    {
                      data.targets.filter((t: any) => t.batchId === batch.id)
                        .length
                    }{" "}
                    个目标
                  </p>
                </div>
                <Badge>{label(batch.state)}</Badge>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>作品 / 账号</th>
                      <th>平台与类型</th>
                      <th>处理状态</th>
                      <th>审核</th>
                      <th>上线</th>
                      <th>详情与操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u: any) => (
                      <tr key={u.id}>
                        <td>
                          <b>
                            {u.snapshot.title} ·{" "}
                            {u.recordingSlot === "audio_B" ? "B 版" : "A 版"}
                          </b>
                          <small>
                            {
                              data.accounts.find(
                                (a: any) => a.id === u.accountId,
                              )?.name
                            }
                          </small>
                          <small>快照 v{u.snapshot.revision}</small>
                        </td>
                        <td>
                          {u.destinations.map((d: any) => (
                            <div key={d.target}>
                              {names[d.target]}
                              <small>
                                {d.kind === "video_post" ? "视频" : "音频发行"}
                              </small>
                            </div>
                          ))}
                        </td>
                        <td>
                          <Badge>{label(u.state)}</Badge>
                          {data.mode === "simulation" && (
                            <small>模拟状态</small>
                          )}
                        </td>
                        <td>{label(u.review)}</td>
                        <td>{label(u.publication)}</td>
                        <td className="actions-cell">
                          {u.issues.map((x: string, i: number) => (
                            <small className="error" key={i}>
                              {x}
                            </small>
                          ))}
                          {u.reason && <small>{u.reason}</small>}
                          {u.receipt && (
                            <small>
                              {u.receipt.remoteId} ·{" "}
                              {date(u.receipt.acceptedAt)} · {u.receipt.source}
                            </small>
                          )}
                          {u.state === "SUBMISSION_UNKNOWN" && (
                            <button
                              onClick={async () =>
                                notify(
                                  (
                                    await call("publish.reconcile", {
                                      id: u.id,
                                    })
                                  ).reason,
                                )
                              }
                            >
                              核对投稿
                            </button>
                          )}
                          {data.mode === "simulation" &&
                            u.state === "READY" && (
                              <select
                                aria-label={"演练故障 " + u.snapshot.title}
                                value={u.fault || ""}
                                onChange={(e) =>
                                  e.target.value &&
                                  call("publish.simulateFault", {
                                    id: u.id,
                                    kind: e.target.value,
                                  })
                                }
                              >
                                <option value="">演练：正常路径</option>
                                <option value="network">
                                  演练：明确未受理失败
                                </option>
                                <option value="unknown">演练：回执丢失</option>
                                <option value="rejected">演练：审核驳回</option>
                              </select>
                            )}
                          {![
                            "COMMITTING",
                            "UPLOADING",
                            "UPLOADED",
                            "PREPARING",
                          ].includes(u.state) && (
                            <button onClick={() => setManualUnit(u)}>
                              人工登记回执与状态
                            </button>
                          )}
                          <button onClick={() => go("track", u.workId)}>
                            作品与素材
                          </button>
                          {u.destinations.some(
                            (d: any) => d.kind === "video_post",
                          ) &&
                            !u.snapshot.assets.video && (
                              <button
                                onClick={() =>
                                  call("video.prepare", {
                                    workId: u.workId,
                                    recordingSlot: u.recordingSlot || "audio_A",
                                  })
                                }
                              >
                                本地生成{" "}
                                {u.recordingSlot === "audio_B" ? "B" : "A"} 版
                                MP4
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="quick-advanced">
                <summary>高级批次操作 · 回执、重试与材料导出</summary>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={
                      data.mode !== "simulation" ||
                      !units.some((u: any) => u.state === "READY")
                    }
                    onClick={() => {
                      setApproval(true);
                      setConfirmed(false);
                    }}
                  >
                    确认演练范围
                  </button>
                  {data.mode === "simulation" &&
                    units.some((u: any) => u.state === "PAUSED") && (
                      <button
                        onClick={() =>
                          call("publish.revalidate", { id: batch.id })
                        }
                      >
                        重新预检，作废旧确认
                      </button>
                    )}
                  <button
                    onClick={() =>
                      exportArtifact("materials", { batchId: batch.id })
                    }
                  >
                    导出人工材料包
                  </button>
                  <button
                    onClick={() => call("publish.pause", { id: batch.id })}
                  >
                    暂停
                  </button>
                  <button
                    disabled={!batch.approved}
                    onClick={() => call("publish.start", { id: batch.id })}
                  >
                    继续已确认演练
                  </button>
                  <button
                    onClick={() => call("publish.retry", { id: batch.id })}
                  >
                    只重试安全失败项
                  </button>
                  <button
                    onClick={() => call("publish.cancel", { id: batch.id })}
                  >
                    取消尚未提交项
                  </button>
                </div>
              </details>
              <HelpNote label="回执与审核说明">
                “已提交”仅代表收到回执；审核通过和已上线分别需要独立证据。未知结果不会加入批量重试。
              </HelpNote>
            </section>
          )}
          <section className="panel">
            <h2>批次记录</h2>
            {[...batches].reverse().map((b: any) => (
              <div className="row" key={b.id}>
                <div>
                  {b.workIds.length} 首作品 · {date(b.createdAt)}
                  <small>
                    {b.id.slice(0, 8)} · {label(b.state)} ·{" "}
                    {b.source === "simulation" ? "模拟演练" : "本地材料准备"}
                  </small>
                </div>
                <button onClick={() => setActive(b.id)}>查看</button>
              </div>
            ))}
            {!batches.length && <p>暂无批次。选择作品后建立第一份发布计划。</p>}
          </section>
        </>
      )}
      {manualUnit && (
        <ManualReport unit={manualUnit} onClose={() => setManualUnit(null)} />
      )}
      {approval && batch && (
        <div>
          <section aria-labelledby="approval-title" className="panel">
            <h2 id="approval-title">确认本次模拟演练</h2>
            <div className="notice">
              不会真实上传、扣费或发布。仅运行以下快照的本地演练。
            </div>
            {units
              .filter((u: any) => u.state === "READY")
              .map((u: any) => (
                <div className="row" key={u.id}>
                  <div>
                    <b>
                      {u.snapshot.title} · v{u.snapshot.revision}
                    </b>
                    <small>
                      {
                        data.accounts.find((a: any) => a.id === u.accountId)
                          ?.name
                      }{" "}
                      →{" "}
                      {u.destinations
                        .map((d: any) => names[d.target])
                        .join(" / ")}
                    </small>
                    <small>
                      来源：{u.snapshot.ai}；权益：{u.snapshot.rights}
                    </small>
                    <small>
                      发布载荷：封面{" "}
                      {u.payload?.cover?.sha256?.slice(0, 8) || "缺失"} · 歌词{" "}
                      {u.payload?.lyrics?.versionId?.slice(0, 8) ||
                        "来源待核实"}{" "}
                      ·{" "}
                      {u.payload?.lyrics?.alignmentConfirmed
                        ? "用户已确认音频匹配"
                        : "歌词 / 音频匹配待确认"}
                    </small>
                  </div>
                </div>
              ))}
            <p>快照 {batch.snapshotHash.slice(0, 24)}… · 费用 ¥0（仅模拟）</p>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我已核对本次作品、版本、身份、目标与演练范围
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={!confirmed}
                onClick={async () => {
                  await call("publish.approve", {
                    id: batch.id,
                    snapshotHash: batch.snapshotHash,
                  });
                  await call("publish.start", { id: batch.id });
                  setApproval(false);
                }}
              >
                开始已确认演练
              </button>
              <button onClick={() => setApproval(false)}>返回检查</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function ExceptionList() {
  const { data, call, notify, go } = useStudio();
  const [filter, setFilter] = useState("all");
  const list = data.exceptions.filter(
    (e: any) =>
      filter === "all" ||
      (filter === "unknown"
        ? e.remoteOutcome === "unknown"
        : e.code === "REVIEW_REJECTED"),
  );
  return (
    <section className="panel">
      <div className="section-title">
        <h2>异常与待处理</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部</option>
          <option value="unknown">远端结果未知</option>
          <option value="rejected">审核驳回</option>
        </select>
      </div>
      {list.map((e: any) => {
        const entity =
          e.kind === "unit"
            ? data.units.find((u: any) => u.id === e.entityId)
            : data.runs.find((r: any) => r.id === e.entityId);
        const work = data.works.find((w: any) => w.id === entity?.workId);
        return (
          <article className="exception-card" key={e.id}>
            <div>
              <h3>
                {work?.title || "任务"} <Badge>{label(e.code)}</Badge>
              </h3>
              <p>
                步骤：{entity?.step || entity?.state} · {date(e.at)} · 来源{" "}
                {e.source}
              </p>
              <p>
                远端是否已提交：
                <b>
                  {e.remoteOutcome === "unknown"
                    ? "未知，必须核对"
                    : e.remoteOutcome === "submitted"
                      ? "已提交"
                      : "未进行真实提交"}
                </b>
              </p>
              <p>
                已有资产 {work?.assetHistory?.length || 0} 个 · 真实费用未接入 ·
                模拟费用 ¥0
              </p>
            </div>
            <div className="button-row">
              {work && (
                <button onClick={() => go("track", work.id)}>
                  查看素材与版本
                </button>
              )}
              {entity?.state === "RETRY_WAIT" && (
                <button onClick={() => call("exception.retry", { id: e.id })}>
                  只重试失败步骤
                </button>
              )}
              {entity?.state === "SUBMISSION_UNKNOWN" && (
                <button
                  onClick={async () =>
                    notify(
                      (await call("publish.reconcile", { id: entity.id }))
                        .reason,
                    )
                  }
                >
                  核对，不重发
                </button>
              )}
              {e.code === "REVIEW_REJECTED" && (
                <Badge>修订后重新预检，不作网络重试</Badge>
              )}
            </div>
          </article>
        );
      })}
      {!list.length && <div className="empty">暂无此类异常。</div>}
    </section>
  );
}
