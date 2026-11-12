import HelpNote from "../components/HelpNote";
import CoverInbox from '../components/CoverInbox';
import "../cover-studio.css";
import React, { useState, useEffect, useRef } from "react";
import { useStudio, PageHead, Cover, Badge } from "../context";
export default function CoverStudio({ initialId }: { initialId?: string }) {
  const { data, call, go, importAsset, exportArtifact } = useStudio();
  const [id, setId] = useState(initialId || data.works[0]?.id || "");
  const initialWork = data.works.find((w: any) => w.id === id);
  const [brief, setBrief] = useState(
      initialWork?.coverBrief ||
        "方形构图，雨天街角，暖紫与雾蓝，细腻电影质感。留出歌名和艺名区域。",
    ),
    [task, setTask] = useState(initialWork?.coverTaskText || ""),
    [size, setSize] = useState(3000),
    [noText, setNoText] = useState(true);
  const work = data.works.find((w: any) => w.id === id);
  const selectedCover = data.assets.find(
    (a: any) => a.id === work?.assets.cover,
  );
  const currentWorkId = useRef(id);
  currentWorkId.current = id;
  const [handoff, setHandoff] = useState<any>({ requests: [], receipts: [] }),
    [requestId, setRequestId] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    if (!id) return {requests: [], receipts: []};
    const rows = await call("cover.list", { workId: id });
    if (currentWorkId.current === id) setHandoff(rows);
    return rows;
  };
  useEffect(() => {
    let active = true;
    setRequestId("");
    setHandoff({ requests: [], receipts: [] });
    if (!id) return () => { active = false; };
    void call("cover.list", { workId: id })
      .then((rows) => {
        if (active) setHandoff(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  const request = handoff.requests.find(
    (r: any) => r.id === requestId && r.workId === id,
  );
  const planLocked=!!handoff.planRecovery?.locked;
  return (
    <div className="cover-studio">
      <PageHead title="封面工作室" action={<HelpNote label="使用说明">
        图片接口未配置。dot 文件交接：导出请求 → 在支持出图的会话生成 →
        接收真实图片。本应用不会直接调用当前 dot 聊天，也没有内置免费 Codex 图像
        API。
      </HelpNote>} />
      {!work ? (
        <div className="panel empty"><p>先创建一首作品，再来制作封面。</p><button className="primary" onClick={() => go("create")}>先创建作品</button></div>
      ) : (
        <>
          <div className="cover-workspace">
            <section className="panel cover-editor">
              <h2>制作封面</h2>
              <label>
                当前作品
                <select
                  aria-label="封面作品"
                  value={id}
                  onChange={(e) => {
                    currentWorkId.current = e.target.value;
                    setId(e.target.value);
                    const selected = data.works.find(
                      (w: any) => w.id === e.target.value,
                    );
                    setTask(selected?.coverTaskText || "");
                    setBrief(selected?.coverBrief || "");
                  }}
                >
                  {data.works.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="cover-story">{work.story}</p>
              <div className="pills">
                <span>{work.config.genre}</span>
                <span>{work.config.mood}</span>
              </div>
              <div className="cover-import-row">
                <button disabled={!!handoff.planRecovery} title={handoff.planRecovery?'请通过当前封面交接请求接收真实图片':undefined} onClick={() => importAsset("cover", id)}>
                  导入本地封面
                </button>
                <span>PNG / JPG / WebP</span>
              </div>
              <CoverInbox workId={id} requestId={requestId||undefined} brief={brief} disabled={planLocked||busy}/>
              <details className="cover-options">
                <summary>提示词与外部出图</summary>
                <div className="cover-options-body">
              <label>
                画面与风格
                <textarea
                  rows={5}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  onClick={async () => {
                    const result = await call("cover.task", {
                      workId: id,
                      brief,
                    });
                    if (currentWorkId.current === id) setTask(result.text);
                  }}
                >
                  生成提示词
                </button>
                <button
                  onClick={() =>
                    exportArtifact("coverTask", {
                      workId: id,
                      brief,
                      editedText: task,
                    })
                  }
                >
                  导出任务
                </button>
              </div>
              {task && (
                <label>
                  任务文本
                  <textarea
                    aria-label="封面任务文本"
                    rows={10}
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                  />
                </label>
              )}
              <details className="cover-handoff" data-testid="cover-handoff" open={handoff.planRecovery ? true : undefined}>
                <summary>外部出图请求与接收</summary>
                <div className="cover-options-body">
                {planLocked&&<p role="status">{handoff.planRecovery.reason==='STOP_REQUESTED'?'本次计划已停止，封面更新已锁定。':'计划最终材料已变化或执行已结束，封面更新已锁定。'}</p>}
                {!!handoff.planRecovery&&!planLocked&&<p className="muted">按当前最终歌词接收并选择封面后，返回计划重试封面阶段。</p>}
                <p>
                  {handoff.receipts.length
                    ? "已接收图片"
                    : "等待真实图片。"}
                </p>
                <button
                  disabled={busy||planLocked}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await call("cover.request", {
                        workId: id,
                        requestId: crypto.randomUUID(),
                        brief,
                        ...(task ? { prompt: task } : {}),
                      });
                      await load();
                      if (currentWorkId.current === id) setRequestId(r.id);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  保存请求
                </button>
                <HelpNote label="交接步骤">
                  保存封面交接请求（不出图）。
                  下一步：把提示词或请求文件交给支持出图的会话，拿到图片后在这里导入。
                  保存请求只记录作品和画面要求，不会启动 dot
                  或任何图像生成服务。
                </HelpNote>
                <label>
                  当前封面请求
                  <select
                    aria-label="当前封面请求"
                    value={requestId}
                    onChange={(e) => setRequestId(e.target.value)}
                  >
                    <option value="">选择已保存请求</option>
                    {handoff.requests.map((r: any) => (
                      <option value={r.id} key={r.id}>
                        {r.id.slice(0, 8)} ·{" "}
                        {r.state === "received" ? "已接收图片" : "等待真实图片"}
                      </option>
                    ))}
                  </select>
                </label>
                {request && (
                  <>
                    <Badge>{request.state === "received" ? "已接收图片" : "等待真实图片"}</Badge>
                    <details>
                      <summary>请求记录</summary>
                      请求 ID：{request.id}
                      <br />
                      上下文：{request.contextHash.slice(0, 12)} ·{" "}
                    </details>
                    <div className="button-row">
                      <button
                        onClick={() =>
                          exportArtifact("coverRequest", { requestId })
                        }
                      >
                        导出 dot 请求 JSON
                      </button>
                      <button
                        onClick={async () => {
                          await importAsset(
                            "coverResultManifest",
                            id,
                            requestId,
                          );
                          await load();
                        }}
                        disabled={planLocked}
                      >
                        导入结果清单
                      </button>
                      <button
                        disabled={planLocked}
                        onClick={async () => {
                          await importAsset("coverResultImage", id, requestId);
                          await load();
                        }}
                      >
                        接收当前请求的真实图片
                      </button>
                    </div>
                  </>
                )}
                <HelpNote label="图片与清单要求">
                  导入结果清单前请先选中对应请求，清单与图片放在同一目录。方形512–10000px，PNG/JPEG/WebP，最多50MiB；3000px是本地工作目标。未提供清单时记为用户导入，不推断生成来源。
                </HelpNote>
                {handoff.receipts
                  .filter((r: any) => r.workId === id)
                  .map((r: any) => (
                    <div className="handoff-receipt" key={r.id}>
                      <span>
                        已接收 · {r.image.width}×{r.image.height} · 请求{" "}
                        {r.requestId.slice(0, 8)} ·{" "}
                        {r.source === "user-import"
                          ? "用户导入"
                          : "外部清单来源声明"}
                      </span>
                      <button
                        disabled={planLocked||work.assets.cover === r.assetId}
                        onClick={() =>
                          call("work.selectAsset", {
                            workId: id,
                            assetId: r.assetId,
                            role: "cover",
                          })
                        }
                      >
                        {work.assets.cover === r.assetId
                          ? "已选为歌曲封面"
                          : "选为歌曲封面"}
                      </button>
                    </div>
                  ))}
                </div>
              </details>
                </div>
              </details>
            </section>
            <section className="panel cover-preview-panel">
              <div className="section-title">
                <h2>封面预览</h2>
                <Badge>
                  {work.assets.cover ? "已导入图片" : "原创占位示例"}
                </Badge>
              </div>
              {work.assets.cover ? (
                <div className="cover large">
                  <img
                    alt={work.title + " 封面"}
                    src={"media://asset/" + work.assets.cover}
                  />
                </div>
              ) : (
                <Cover work={work} large />
              )}
              {selectedCover && (
                <p className="cover-image-meta">
                  {selectedCover.metadata.width} ×{" "}
                  {selectedCover.metadata.height} ·{" "}
                  {selectedCover.parentId
                    ? "派生版本 · 原件保留"
                    : "导入原图"}
                </p>
              )}
              <div className="cover-export">
              <h3>导出设置</h3>
              <div className="form-grid">
                <label>
                  工作预设
                  <select
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                  >
                    <option value={3000}>3000 × 3000 · 母版</option>
                    <option value={1400}>1400 × 1400 · 预览</option>
                  </select>
                </label>
                <label>
                  输出排版
                  <select
                    value={String(noText)}
                    onChange={(e) => setNoText(e.target.value === "true")}
                  >
                    <option value="false">歌名 + 艺名</option>
                    <option value="true">无字母版</option>
                  </select>
                </label>
              </div>
              <div className="cover-export-actions">
              <button
                className="primary"
                disabled={!work.assets.cover}
                onClick={() =>
                  exportArtifact("cover", { workId: id, size, noText })
                }
              >
                导出封面
              </button>
              <HelpNote label="尺寸与排版说明">
                导出 PNG 并保存派生版本，原件保留。本地工作预设，各平台当前规格待核实。文字排版以导出文件为准。
              </HelpNote>
              </div>
              </div>
            </section>
          </div>
          <section className="panel cover-versions">
            <h2>封面版本</h2>
            <div className="asset-grid">
              {data.assets
                .filter(
                  (a: any) =>
                    work.assetHistory.includes(a.id) && a.kind === "image",
                )
                .map((a: any) => (
                  <button
                    key={a.id}
                    className={
                      "asset-card " +
                      (work.assets.cover === a.id ? "active" : "")
                    }
                    onClick={() =>
                      call("work.selectAsset", {
                        workId: id,
                        assetId: a.id,
                        role: "cover",
                      })
                    }
                  >
                    <img alt={a.label} src={"media://asset/" + a.id} />
                    <span>{a.parentId ? "本地排版衍生" : "导入母版"}</span>
                    <small>
                      {a.metadata.width} × {a.metadata.height} ·{" "}
                      {a.sha256.slice(0, 8)}
                    </small>
                  </button>
                ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
