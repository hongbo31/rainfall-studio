import ManualReport from "../components/ManualReport";
import React, { useState } from "react";
import { useStudio, PageHead, Badge, names, label, date } from "../context";
const platforms = ["netease", "qishui", "qqmusic", "kugou", "douyin"];
export default function PublishCenter() {
  const { data, call, go, selected, exportArtifact, notify } = useStudio();
  const [map, setMap] = useState<Record<string, string>>({}),
    [chosen, setChosen] = useState<string[]>([]),
    [active, setActive] = useState(data.batches.at(-1)?.id || ""),
    [approval, setApproval] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [showExceptions, setShowExceptions] = useState(false),
    [manualUnit, setManualUnit] = useState<any>(null);
  const works = data.works.filter((w: any) => selected.includes(w.id));
  const batch = data.batches.find((b: any) => b.id === active);
  const units = data.units.filter((u: any) => u.batchId === active);
  const toggle = (id: string) =>
    setChosen(
      chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id],
    );
  const plan = async () => {
    if (new Set(works.map((w: any) => w.artistId)).size !== 1) {
      notify("每批请选择同一艺人的作品，以明确账号绑定。");
      return;
    }
    const destinations = chosen.map((target) => {
      const accountId = map[target];
      const b = data.bindings.find(
        (b: any) =>
          b.artistId === works[0].artistId &&
          b.accountId === accountId &&
          b.targets.includes(target) &&
          b.status !== "revoked",
      );
      if (!b) throw Error("请选择已绑定此艺人的平台账号");
      return {
        target,
        accountId,
        bindingId: b.id,
        kind: target === "douyin" ? "video_post" : "audio_distribution",
      };
    });
    const b = await call("publish.plan", { workIds: selected, destinations });
    setActive(b.id);
  };
  return (
    <>
      <PageHead
        title="让作品，走向更多人。"
        sub="把素材、身份与授权准备清楚，再认真确认每一次提交。"
        action={
          <button onClick={() => setShowExceptions(!showExceptions)}>
            {showExceptions ? "返回批次" : "异常与待处理"}{" "}
            <Badge>{data.exceptions.length}</Badge>
          </button>
        }
      />
      <div className="notice">
        {data.mode === "simulation"
          ? "模拟演练工作区：所有远端回执均为模拟，不会访问或投稿真实平台。"
          : "真实本地工作区：自动投稿未接入；可完成预检、视频包装和人工材料导出。"}{" "}
        音频发行与抖音视频投稿分别准备。
      </div>
      {showExceptions ? (
        <ExceptionList />
      ) : (
        <>
          <section className="panel">
            <div className="section-title">
              <h2>01 / 批量发布准备</h2>
              <Badge>已选择 {selected.length} 首</Badge>
            </div>
            {!works.length ? (
              <div className="empty">
                先到作品库勾选作品。
                <button onClick={() => go("library")}>选择作品 →</button>
              </div>
            ) : (
              <>
                <div className="selected-titles">
                  {works.map((w: any) => (
                    <Badge key={w.id}>{w.title}</Badge>
                  ))}
                </div>
                <div className="destination-list">
                  {platforms.map((target) => {
                    const accounts = data.accounts.filter(
                      (a: any) =>
                        a.provider === target ||
                        (["qqmusic", "kugou"].includes(target) &&
                          a.provider === "tme"),
                    );
                    return (
                      <div className="destination" key={target}>
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={chosen.includes(target)}
                            onChange={() => toggle(target)}
                          />
                          <b>{names[target]}</b>
                          <small>
                            {target === "douyin"
                              ? "视频投稿 · 需MP4"
                              : "音频发行"}
                          </small>
                        </label>
                        <select
                          aria-label={names[target] + "账号"}
                          value={map[target] || ""}
                          onChange={(e) =>
                            setMap({ ...map, [target]: e.target.value })
                          }
                        >
                          <option value="">选择账号与艺人绑定</option>
                          {accounts.map((a: any) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {label(a.authStatus)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={!chosen.length || chosen.some((x) => !map[x])}
                    onClick={() => plan().catch((e) => notify(e.message))}
                  >
                    生成批次并预检 →
                  </button>
                  <button onClick={() => go("accounts")}>配置艺人与账号</button>
                </div>
                <p>
                  同批作品需属于同一艺人；跨艺人分别准备，可避免账号归属混用。目标未获准仍保留阻塞原因。
                </p>
              </>
            )}
          </section>
          {batch && (
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>02 / 预检与执行范围</h2>
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
                          <b>{u.snapshot.title}</b>
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
                                  call("video.prepare", { workId: u.workId })
                                }
                              >
                                本地生成 MP4
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                <button onClick={() => call("publish.pause", { id: batch.id })}>
                  暂停
                </button>
                <button
                  disabled={!batch.approved}
                  onClick={() => call("publish.start", { id: batch.id })}
                >
                  继续已确认演练
                </button>
                <button onClick={() => call("publish.retry", { id: batch.id })}>
                  只重试安全失败项
                </button>
                <button
                  onClick={() => call("publish.cancel", { id: batch.id })}
                >
                  取消尚未提交项
                </button>
              </div>
              <p>
                “已提交”仅代表收到回执；审核通过和已上线分别需要独立证据。未知结果不会加入批量重试。
              </p>
            </section>
          )}
          <section className="panel">
            <h2>批次记录</h2>
            {[...data.batches].reverse().map((b: any) => (
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
            {!data.batches.length && (
              <p>暂无批次。选择作品后建立第一份发布计划。</p>
            )}
          </section>
        </>
      )}
      {manualUnit && (
        <ManualReport unit={manualUnit} onClose={() => setManualUnit(null)} />
      )}
      {approval && batch && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-title"
            className="modal"
          >
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
