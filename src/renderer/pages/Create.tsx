import React, { useState } from "react";
import {
  useStudio,
  PageHead,
  SelectArtist,
  Badge,
  label,
} from "../context";
export default function Create() {
  const { data, call, go, notify } = useStudio();
  const [artist, setArtist] = useState(data.artists[0]?.id || "");
  const defaults =
    data.artists.find((a: any) => a.id === artist)?.defaults || {};
  const [form, setForm] = useState({
    title: "",
    story: "",
    genre: "",
    language: "",
    voice: "",
    mood: "",
    duration: "",
    lyricTone: "",
    bpmMin: "",
    bpmMax: "",
    coverStyle: "",
  });
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });
  const overrides = () =>
    Object.fromEntries(
      Object.entries(form)
        .filter(([k, v]) => !["title", "story"].includes(k) && v !== "")
        .map(([k, v]) => [
          k,
          ["duration", "bpmMin", "bpmMax"].includes(k) ? Number(v) : v,
        ]),
    );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await call("creation.start", {
      artistId: artist,
      title: form.title,
      story: form.story,
      overrides: overrides(),
    });
    go("track", r.workId);
    notify("本地模板草稿已保存，尚未经过模型创作或评分；音频需生成后导入。");
  };
  return (
    <>
      <PageHead title="本地模板" />
      <Badge>本地模板 · 不调用模型</Badge>
      <div className="split">
        <form
          className="panel"
          onSubmit={(e) => {
            void submit(e).catch(() => {});
          }}
        >
          <div className="section-title">
            <h2>创作设定</h2>
            <Badge>可覆盖艺人默认值</Badge>
          </div>
          <SelectArtist value={artist} onChange={setArtist} />
          <label>
            歌名
            <input
              required
              aria-label="歌名"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="为这段故事起个名字"
              maxLength={200}
            />
          </label>
          <div className="form-grid">
            <label>
              音乐风格
              <input
                value={form.genre}
                placeholder={"继承：" + defaults.genre}
                onChange={(e) => set("genre", e.target.value)}
              />
            </label>
            <label>
              语言
              <input
                value={form.language}
                placeholder={"继承：" + defaults.language}
                onChange={(e) => set("language", e.target.value)}
              />
            </label>
            <label>
              人声
              <select
                value={form.voice}
                onChange={(e) => set("voice", e.target.value)}
              >
                <option value="">继承：{defaults.voice}</option>
                <option value="female">女声</option>
                <option value="male">男声</option>
                <option value="duet">对唱</option>
                <option value="instrumental">纯音乐</option>
              </select>
            </label>
            <label>
              情绪
              <input
                value={form.mood}
                placeholder={"继承：" + defaults.mood}
                onChange={(e) => set("mood", e.target.value)}
              />
            </label>
            <label>
              BPM 下限
              <input
                type="number"
                min="20"
                max="300"
                value={form.bpmMin}
                placeholder={String(defaults.bpmMin)}
                onChange={(e) => set("bpmMin", e.target.value)}
              />
            </label>
            <label>
              BPM 上限
              <input
                type="number"
                min="20"
                max="300"
                value={form.bpmMax}
                placeholder={String(defaults.bpmMax)}
                onChange={(e) => set("bpmMax", e.target.value)}
              />
            </label>
            <label>
              时长参考（秒）
              <input
                type="number"
                min="10"
                max="1800"
                value={form.duration}
                placeholder={String(defaults.duration)}
                onChange={(e) => set("duration", e.target.value)}
              />
            </label>
            <label>
              歌词语气
              <input
                value={form.lyricTone}
                placeholder={defaults.lyricTone}
                onChange={(e) => set("lyricTone", e.target.value)}
              />
            </label>
          </div>
          <label>
            封面风格
            <input
              value={form.coverStyle}
              placeholder={defaults.coverStyle}
              onChange={(e) => set("coverStyle", e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              setForm({
                ...form,
                genre: "",
                language: "",
                voice: "",
                mood: "",
                duration: "",
                lyricTone: "",
                bpmMin: "",
                bpmMax: "",
                coverStyle: "",
              })
            }
          >
            重置为继承艺人默认
          </button>
          <h3>故事</h3>
          <label>
            故事、画面或一句心事
            <textarea
              aria-label="故事"
              rows={5}
              required
              value={form.story}
              onChange={(e) => set("story", e.target.value)}
              placeholder="那天刚好下雨，你把伞往我这边倾斜……"
              maxLength={20000}
            />
          </label>
          <div className="button-row">
            <button className="primary" type="submit">
              用本地模板起草 →
            </button>
          </div>
        </form>
        <div>
          <details className="panel">
            <summary>生成平台</summary>
                <Badge>官网生成后导入</Badge>
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
          </details>
          <section className="panel">
            <h2>创作任务</h2>
            {data.runs
              .filter((r: any) => !r.planId)
              .slice(-6)
              .reverse()
              .map((r: any) => (
                <div className="row" key={r.id}>
                  <div>
                    {data.works.find((w: any) => w.id === r.workId)?.title}
                    <small>
                      {label(r.state)} · 当前步骤 {r.step}
                    </small>
                  </div>
                  <button onClick={() => go("track", r.workId)}>继续 →</button>
                </div>
              ))}
          </section>
        </div>
      </div>
    </>
  );
}
