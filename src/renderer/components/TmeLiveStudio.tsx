import React, { useEffect, useState } from "react";
import { useStudio, Badge, date } from "../context";
import type { TmeLiveUnit } from "../../shared/tme";
import TmeObservationReport from './TmeObservationReport';
import HelpNote from "./HelpNote";
const labels: Record<string, string> = {
  TME_READY: "等待本首上传",
  TME_BLOCKED: "资料需处理",
  TME_STAGING: "上传并填写中",
  TME_AWAITING_AUTHORIZATION: "待官网核对与授权",
  TME_AWAITING_SUBMIT: "已确认本首授权 · 待单独提交",
  TME_RECONCILE_REQUIRED: "结果未知 · 先核对",
  TME_REVIEWING: "审核中",
  TME_PUBLISHED: "已发布",
  TME_REJECTED: "已驳回",
  TME_OBSERVED_EXISTING: "已看到同名作品 · 需人工核对录音",
  TME_CANCELLED: "已取消",
};
const reason: Record<string, string> = {
  PREFLIGHT_REQUIRED: "本首尚未保存通过预检的资料",
  EXISTING_ALBUM_REQUIRED: "本通道需要明确的现有专辑 ID，并保留共享封面",
  ALBUM_CHANGED: "官网所在专辑与本首目标不同，请核对后重新建立批次",
  REMOTE_CHECK_REQUIRED: "已有外部活动或回执，先核对远端",
  CONTINUE_OFFICIAL_FORM_SELECT_AUTHORIZATION:
    "已填写本首。请在官网核对完整资料、继续下一步并亲自选择授权模式，再回到这里读取协议。",
  PER_SONG_AUTHORIZATION_REQUIRED: "本首需要重新阅读并确认协议",
  REMOTE_STATE_UNKNOWN: "当前页面不足以证明远端结果；禁止直接重传",
  SESSION_REBIND_REQUIRES_READBACK:
    "会话已更换，先人工核对远端；不会跨会话自动续传",
  DATE_PICKER_MONTH_REQUIRES_USER:
    "日期控件需要在官网核对月份后手工完成；当前结果待核对",
  EXTERNAL_AUTHORS_REQUIRE_OFFICIAL_FORM:
    "非本人作者需在官网手工核对署名和授权",
  CONTROL_NOT_UNIQUE: "页面控件发生变化，已停止；请在官网核对当前表单",
  VISIBLE_ROW_REQUIRES_MANUAL_RECORDING_MATCH:
    "只匹配了可见歌名和专辑，尚未验证是同一录音",
};
export default function TmeLiveStudio({
  accountId,
  title,
  albumId,
}: {
  accountId: string;
  title: string;
  albumId: string;
}) {
  const { data, selected, call, notify, go } = useStudio();
  const [expected, setExpected] = useState(""),
    [connection, setConnection] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [state, setState] = useState<any>({ batches: [], units: [] }),
    [active, setActive] = useState(""),
    [review, setReview] = useState<any>(null),
    [consent, setConsent] = useState(false),
    [uploadConsent, setUploadConsent] = useState(false),
    [readTitle, setReadTitle] = useState(title),
    [readAlbum, setReadAlbum] = useState(albumId),
    [observation, setObservation] = useState<any>(null);
  useEffect(() => {
    setConnection(null);
    setReview(null);
    setConsent(false);
    setUploadConsent(false);
  }, [accountId]);
  useEffect(() => {
    setReadTitle(title);
  }, [title]);
  useEffect(() => {
    setReadAlbum(albumId);
  }, [albumId]);
  const load = async () => setState(await call("tme.batches"));
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  const request = async (
    action: Parameters<typeof window.rainfall.tmeLive>[0],
    input: any,
  ) => {
    const r = await window.rainfall.tmeLive(action, input);
    if (!r.ok) throw Error(reason[r.error.code] || r.error.message);
    return r.value;
  };
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
      await load().catch(() => {});
    }
  };
  const units: TmeLiveUnit[] = state.units.filter(
    (u: TmeLiveUnit) => u.batchId === active,
  );
  const resetReview = () => {
    setReview(null);
    setConsent(false);
  };
  return (
    <>
      <TmeObservationReport accountId={accountId} />
      <section className="panel" data-testid="tme-live-studio">
        <div className="notice">只读核对 · 上传与提交未启用</div>
        <div className="section-title">
          <div>
            <h2>腾讯窗口连接</h2>
          </div>
          <Badge>{connection ? "已核对本次窗口" : "尚未连接"}</Badge>
        </div>
        <HelpNote label="窗口核对方式">
          先在 Chrome / Edge
          打开目标腾讯音乐人专辑。填写官网右上角可见昵称，再由本次按钮读取窗口。不会改变浏览器连接设置。
        </HelpNote>
        <label>
          当前官网可见昵称
          <input
            aria-label="腾讯官网可见昵称"
            value={expected}
            onChange={(e) => {
              setExpected(e.target.value);
              setConnection(null);
              resetReview();
            }}
            placeholder="与右上角昵称完全一致"
          />
        </label>
        <button
          disabled={
            busy || !expected.trim() || !accountId || data.mode !== "production"
          }
          onClick={() =>
            perform(async () => {
              const c = await request("inspect", {
                expectedAccount: expected.trim(),
                accountId,
              });
              setConnection(c);
              resetReview();
            })
          }
        >
          只读识别此官网窗口
        </button>
        {connection && (
          <div><p>{connection.identity.displayName}</p>
          <HelpNote label="窗口身份说明">
            {connection.identity.displayName} · Windows UIA ·
            本次可见昵称与窗口绑定。官网未提供唯一用户
            ID；昵称相同的不同账号不能自动区分。重启后需重新核对，历史任务先回读。
          </HelpNote>
          </div>
        )}
        <div className="form-grid">
          <label>
            只读核对歌名
            <input
              aria-label="腾讯只读歌名"
              value={readTitle}
              onChange={(e) => setReadTitle(e.target.value)}
            />
          </label>
          <label>
            目标专辑 ID
            <input
              aria-label="腾讯只读专辑ID"
              value={readAlbum}
              onChange={(e) => setReadAlbum(e.target.value)}
            />
          </label>
        </div>
        <button
          disabled={
            busy || !connection || !readTitle || !/^\d+$/.test(readAlbum)
          }
          onClick={() =>
            perform(async () =>
              setObservation(
                await request("sync", { title: readTitle, albumId: readAlbum }),
              ),
            )
          }
        >
          只读同步当前列表状态
        </button>
        {observation && (
          <div className="notice" data-testid="tme-live-observation">
            {observation.receipt ? (
              <>
                <strong>
                  {observation.receipt.title} ·{" "}
                  {labels["TME_" + observation.receipt.status.toUpperCase()] ||
                    "状态未知"}
                </strong>
                <p>
                  专辑 ID {observation.receipt.albumId} · 歌曲 ID{" "}
                  {observation.receipt.songId || "官网可见页面未提供"} ·{" "}
                  {date(observation.receipt.observedAt)} · Windows UIA
                </p>
                <p>
                  录音未核实 · 非客户端提交回执
                  {observation.receipt.reason || ""}
                </p>
              </>
            ) : (
              "当前可见页面未找到唯一匹配行，请打开目标专辑歌曲列表后再核对。不会据此重传。"
            )}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="section-title">
          <h2>所选作品 · 逐首上传批次</h2>
          <Badge>已选 {selected.length} 首</Badge>
        </div>
        <HelpNote label="批次准备说明">
          每首先在上方保存资料预检。从创作中心选择作品。同一账号、同一艺人的作品串行处理。缺资料项会单独显示。追加到现有专辑时保留共享封面。
        </HelpNote>
        <div className="selected-titles">
          {data.works
            .filter((w: any) => selected.includes(w.id))
            .map((w: any) => (
              <Badge key={w.id}>{w.title}</Badge>
            ))}
        </div>
        <div className="button-row">
          <button onClick={() => go("chat")}>调整作品多选</button>
          <button
            disabled={
              busy ||
              !selected.length ||
              !accountId ||
              data.mode !== "production"
            }
            onClick={() =>
              perform(async () => {
                const b = await call("tme.batchPlan", {
                  workIds: selected,
                  accountId,
                });
                setActive(b.id);
                setUploadConsent(false);
                resetReview();
              })
            }
          >
            为所选作品建立批次
          </button>
        </div>
        <label>
          已有腾讯批次
          <select
            aria-label="腾讯上传批次"
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              resetReview();
              setUploadConsent(false);
            }}
          >
            <option value="">选择批次</option>
            {state.batches
              .filter((b: any) => b.accountId === accountId)
              .map((b: any) => (
                <option key={b.id} value={b.id}>
                  {date(b.createdAt)} · {b.workIds.length} 首 ·{" "}
                  {b.cancelled ? "已取消" : b.state}
                </option>
              ))}
          </select>
        </label>
        {active && (
          <>
            <label className="inline-check">
              <input
                type="checkbox"
                aria-label="仅允许本批逐首上传填写"
                checked={uploadConsent}
                onChange={(e) => setUploadConsent(e.target.checked)}
              />
              已核对所选作品与当前账号，仅允许逐首上传、填写；每首的授权和提交仍需另行确认
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || !connection?.writeAllowed || !uploadConsent}
                onClick={() =>
                  perform(async () => {
                    resetReview();
                    await request("run", { batchId: active, confirmed: true });
                    setUploadConsent(false);
                  })
                }
              >
                开始 / 继续下一首上传
              </button>
              <button
                onClick={() => {
                  void call("tme.batchCancel", { id: active })
                    .then(() =>
                      connection
                        ? request("cancel", { batchId: active })
                        : undefined,
                    )
                    .then(() => {
                      resetReview();
                      return load();
                    })
                    .catch((e: any) => notify(e.message));
                }}
              >
                取消批次后续歌曲
              </button>
              <small>已开始的操作仍需核对</small>
              <button disabled={busy} onClick={load}>
                刷新批次
              </button>
            </div>
          </>
        )}
        {units.map((u) => (
          <article className="account-card" key={u.id}>
            <div className="section-title">
              <h3>
                {data.works.find((w: any) => w.id === u.workId)?.title ||
                  "本地作品"}
              </h3>
              <Badge>{labels[u.state] || u.state}</Badge>
            </div>
            <p>
              {reason[u.reason] || u.reason || "等待处理"}
              {u.issues.length
                ? " · " + u.issues.map((x) => reason[x] || x).join("；")
                : ""}
            </p>
            {u.receipt && (
              <p>
                可见回执：{u.receipt.status} · 歌曲 ID{" "}
                {u.receipt.songId || "未知"} · 专辑 {u.receipt.albumId} ·{" "}
                {date(u.receipt.observedAt)}
              </p>
            )}
            {["TME_AWAITING_AUTHORIZATION", "TME_AWAITING_SUBMIT"].includes(
              u.state,
            ) && (
              <button
                disabled={busy || !connection?.writeAllowed}
                onClick={() =>
                  perform(async () => {
                    resetReview();
                    setReview(await request("review", { unitId: u.id }));
                  })
                }
              >
                读取本首当前协议与操作范围
              </button>
            )}
            {u.state === "TME_RECONCILE_REQUIRED" && (
              <button
                disabled={busy || !connection}
                onClick={() =>
                  perform(async () => {
                    await request("reconcile", { unitId: u.id });
                  })
                }
              >
                只读核对本首远端结果
              </button>
            )}
          </article>
        ))}
        {review && (
          <div className="tme-review">
            <h3>
              {review.action === "accept" ? "确认本首协议" : "单独提交本首审核"}{" "}
              · {review.title}
            </h3>
            <p>
              专辑 {review.albumId} · 当前选择 {review.agreement.modeText} ·
              协议摘要 {review.contractHash.slice(0, 16)}
            </p>
            <label>
              官网当前可见协议原文
              <textarea
                aria-label="本首腾讯协议原文"
                readOnly
                value={review.agreement.text}
                rows={12}
              />
            </label>
            <p>
              歌名依据本次已上传并回读的表单；授权页可能不再展示歌名，请同时核对官网当前作品。许可仅适用此首、此版本、此协议，5
              分钟内单次有效。
            </p>
            <label className="inline-check">
              <input
                type="checkbox"
                aria-label="确认本首当前操作"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {review.action === "accept"
                ? "我已核对本首作品并阅读协议，只确认本首授权，不提交审核"
                : "我已核对本首资料与已接受的协议，明确提交本首审核"}
            </label>
            <button
              className="primary"
              disabled={busy || !connection?.writeAllowed || !consent}
              onClick={() =>
                perform(async () => {
                  const r = await request("act", {
                    unitId: review.unitId,
                    action: review.action,
                    permit: review.permit,
                    reviewHash: review.reviewHash,
                    confirmed: true,
                  });
                  resetReview();
                  notify(
                    r.state === "TME_RECONCILE_REQUIRED"
                      ? "结果待核对，已禁止重传。"
                      : "本次操作已回读，请查看状态。",
                  );
                })
              }
            >
              {review.action === "accept" ? "仅确认本首授权" : "提交本首审核"}
            </button>
          </div>
        )}
        <HelpNote label="中断与取消说明">
          未知结果保留意图与重复保护，不能直接重传。取消只阻止后续歌曲；已经开始的官网操作仍需回读。协议与提交不会自动应用到下一首。
        </HelpNote>
      </section>
    </>
  );
}
