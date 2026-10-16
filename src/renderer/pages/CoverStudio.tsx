import React, { useState } from "react";
import { useStudio, PageHead, Cover, Badge } from "../context";
export default function CoverStudio({ initialId }: { initialId?: string }) {
  const { data, call, importAsset, exportArtifact } = useStudio();
  const [id, setId] = useState(initialId || data.works[0]?.id || "");
  const initialWork = data.works.find((w: any) => w.id === id);
  const [brief, setBrief] = useState(
      initialWork?.coverBrief ||
        "方形构图，雨天街角，暖紫与雾蓝，细腻电影质感。留出歌名和艺名区域。",
    ),
    [task, setTask] = useState(initialWork?.coverTaskText || ""),
    [size, setSize] = useState(3000),
    [noText, setNoText] = useState(false);
  const work = data.works.find((w: any) => w.id === id);
  return (
    <>
      <PageHead
        title="让声音，也拥有画面。"
        sub="从歌词、故事与曲风提炼封面方向，保存每一次视觉探索。"
      />
      <div className="notice">
        Codex 协作：导出任务 → 在支持的会话中生成 → 导入结果。本应用没有内置免费
        Codex 图像 API。
      </div>
      {!work ? (
        <div className="panel empty">先创建一首作品，再来制作封面。</div>
      ) : (
        <>
          <div className="split">
            <section className="panel">
              <h2>01 / 作品与视觉方向</h2>
              <label>
                当前作品
                <select
                  aria-label="封面作品"
                  value={id}
                  onChange={(e) => {
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
              <p>{work.story}</p>
              <div className="pills">
                <span>{work.config.genre}</span>
                <span>{work.config.mood}</span>
              </div>
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
                  className="primary"
                  onClick={async () =>
                    setTask(
                      (await call("cover.task", { workId: id, brief })).text,
                    )
                  }
                >
                  生成封面提示词 · 本地
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
                  导出 Codex 任务 ↗
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
              <h3>02 / 导入生成结果</h3>
              <button onClick={() => importAsset("cover", id)}>
                ＋ 导入本地封面
              </button>
              <p>
                PNG / JPG / WebP；最多50 MiB / 100MP。原件保留，排版另存新版本。
              </p>
            </section>
            <section className="panel">
              <div className="section-title">
                <h2>封面预览</h2>
                <Badge>
                  {work.assets.cover ? "已导入图片" : "原创占位示例"}
                </Badge>
              </div>
              <Cover work={work} large />
              <h3>03 / 排版与尺寸适配</h3>
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
              <button
                className="primary"
                disabled={!work.assets.cover}
                onClick={() =>
                  exportArtifact("cover", { workId: id, size, noText })
                }
              >
                导出 PNG 并保存派生版本
              </button>
              <p>
                本地工作预设，各平台当前规格待核实。文字排版以导出文件为准。
              </p>
            </section>
          </div>
          <section className="panel">
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
    </>
  );
}
