import React, { useState, useRef, useEffect } from "react";
import { useStudio, PageHead, Cover, Badge, date, label } from "../context";
export default function Track({ id }: { id: string }) {
  const { data, call, go, play, importAsset, notify } = useStudio();
  const work = data.works.find((w: any) => w.id === id);
  const [form, setForm] = useState({ ...work });
  const expected = useRef(work.revision),
    saved = useRef(JSON.stringify(form)),
    latest = useRef(form);
  latest.current = form;
  const [status, setStatus] = useState("已保存");
  const chain = useRef(Promise.resolve());
  const [left, setLeft] = useState("current"),
    [right, setRight] = useState("current");
  const persist = () => {
    const value = { ...latest.current };
    if (JSON.stringify(value) === saved.current) return chain.current;
    chain.current = chain.current
      .catch(() => {})
      .then(async () => {
        setStatus("保存中…");
        try {
          const result = await call("work.save", {
            id,
            expected: expected.current,
            title: value.title,
            artistId: value.artistId,
            story: value.story,
            lyrics: value.lyrics,
            prompt: value.prompt,
            parameters: value.parameters || {},
            ...(value.seriesId ? { seriesId: value.seriesId } : {}),
            rights: value.rights,
            ai: value.ai,
          });
          expected.current = result.revision;
          saved.current = JSON.stringify(value);
          setStatus("已保存");
        } catch {
          setStatus("保存失败 · 内容仍在此页");
        }
      });
    return chain.current;
  };
  const saveRef = useRef(persist);
  saveRef.current = persist;
  useEffect(() => {
    if (JSON.stringify(form) === saved.current) return;
    setStatus("等待保存…");
    const timer = setTimeout(() => {
      void saveRef.current();
    }, 500);
    return () => clearTimeout(timer);
  }, [form]);
  useEffect(
    () => () => {
      void saveRef.current();
    },
    [],
  );
  const versions = [
    { ...work, id: "current", label: "当前草稿" },
    ...data.revisions
      .filter((r: any) => r.workId === id)
      .map((r: any) => ({
        ...r,
        label: "v" + r.revision + " · " + date(r.createdAt),
      })),
  ];
  const view = (v: string) =>
    versions.find((r: any) => r.id === v) || versions[0];
  const run = data.runs.find(
    (r: any) => r.workId === id && r.state !== "succeeded",
  );
  return (
    <>
      <PageHead
        title={work.title}
        sub={"本地作品 · v" + expected.current + " · " + status}
        action={
          <div className="button-row">
            <button
              onClick={async () => {
                await persist();
                await call("work.version", { id });
                notify("已保存独立版本快照");
              }}
            >
              保存版本
            </button>
            <button className="primary" onClick={() => go("cover", id)}>
              封面工作室 →
            </button>
          </div>
        }
      />
      <div className="detail-grid">
        <div>
          <Cover work={work} large />
          <div className="panel">
            <h2>A / B 试听</h2>
            <div className="button-row">
              <button
                disabled={!work.assets.audio_A}
                onClick={() => play(work, "audio_A")}
              >
                ▷ 试听 A
              </button>
              <button
                disabled={!work.assets.audio_B}
                onClick={() => play(work, "audio_B")}
              >
                ▷ 试听 B
              </button>
            </div>
            <div className="button-row">
              <button onClick={() => importAsset("audio_A", id)}>
                导入音频 A
              </button>
              <button onClick={() => importAsset("audio_B", id)}>
                导入音频 B
              </button>
            </div>
            <p>音频复制入库，退出重开仍可试听；没有音频时不显示假播放。</p>
            <label>
              音频 A 版本
              <select
                value={work.assets.audio_A || ""}
                onChange={(e) =>
                  call("work.selectAsset", {
                    workId: id,
                    assetId: e.target.value,
                    role: "audio_A",
                  })
                }
              >
                <option value="" disabled>
                  尚未导入
                </option>
                {data.assets
                  .filter(
                    (a: any) =>
                      work.assetHistory.includes(a.id) && a.kind === "audio",
                  )
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.label} · {a.sha256.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
            <Badge>
              {work.assets.audio_A ? "本地音频已受管" : "等待音频导入"}
            </Badge>
          </div>
          {run && (
            <div className="panel">
              <h2>创作任务</h2>
              {run.state === "waiting_confirmation" &&
                ["candidate", "cover"].includes(run.step) && (
                  <button
                    className="primary"
                    onClick={() =>
                      call("run.confirm", { id: run.id, step: run.step })
                    }
                  >
                    {run.step === "candidate"
                      ? "确认当前候选音频"
                      : "确认当前封面"}
                  </button>
                )}
              <p>
                {label(run.state)} · {run.step}
              </p>
              {run.step === "lyrics" && (
                <button
                  onClick={() =>
                    call("run.confirm", { id: run.id, step: "lyrics" })
                  }
                >
                  确认歌词，继续
                </button>
              )}
              <div className="button-row">
                <button onClick={() => window.rainfall.openOfficial("suno")}>
                  Suno ↗
                </button>
                <button
                  onClick={() => window.rainfall.openOfficial("yourmusic")}
                >
                  谱乐 AI ↗
                </button>
              </div>
              <button
                onClick={async () => {
                  await persist();
                  await call("goal.complete", {
                    workId: id,
                    ...(run.planId ? { planId: run.planId } : {}),
                  });
                  notify("已记为独立成品");
                }}
              >
                确认成品（先完成候选与封面确认）
              </button>
            </div>
          )}
        </div>
        <div>
          <div className="panel">
            <h2>歌词与创作提示</h2>
            {[
              ["title", "歌名", 1],
              ["story", "故事", 3],
              ["lyrics", "歌词", 9],
              ["prompt", "提示词", 4],
            ].map(([k, n, rows]) => (
              <label key={String(k)}>
                {n}
                {rows === 1 ? (
                  <input
                    aria-label={"编辑" + n}
                    value={form[String(k)]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  />
                ) : (
                  <textarea
                    aria-label={"编辑" + n}
                    rows={Number(rows)}
                    value={form[String(k)]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <div className="button-row">
              <button onClick={() => persist()}>立即保存</button>
              <Badge>{status}</Badge>
            </div>
          </div>
          <div className="panel">
            <h2>来源与授权依据</h2>
            <label>
              商用依据与来源
              <textarea
                aria-label="授权依据"
                rows={3}
                value={form.rights}
                onChange={(e) => setForm({ ...form, rights: e.target.value })}
              />
            </label>
            <label>
              AI 参与声明
              <select
                value={form.ai}
                onChange={(e) => setForm({ ...form, ai: e.target.value })}
              >
                <option value="unknown">待确认</option>
                <option value="none">本人声明：无 AI 生成</option>
                <option value="assisted">AI 辅助</option>
                <option value="generated">AI 生成</option>
              </select>
            </label>
            <button onClick={() => importAsset("rights", id)}>
              导入授权依据附件
            </button>
            <p>
              本地记录不替代完整权利核验。正式发布前仍需确认各素材的商用依据及
              AI 标识。
            </p>
          </div>
        </div>
      </div>
      <section className="panel">
        <h2>歌词与提示词版本对照</h2>
        <div className="compare">
          {[
            [left, setLeft],
            [right, setRight],
          ].map(([value, setter]: any, i) => (
            <div key={i}>
              <select
                aria-label={i ? "右侧版本" : "左侧版本"}
                value={value}
                onChange={(e) => setter(e.target.value)}
              >
                {versions.map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <pre>{view(value).lyrics || "暂无歌词"}</pre>
              <p>{view(value).prompt}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
