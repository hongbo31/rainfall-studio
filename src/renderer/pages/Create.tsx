import React, { useState } from "react";
import {
  useStudio,
  PageHead,
  SelectArtist,
  Badge,
  date,
  label,
} from "../context";
const policy = {
  lyrics: "automatic",
  candidate: "manual",
  cover: "manual",
  finished: "manual",
  publish: "manual",
};
export default function Create() {
  const { data, call, go, notify } = useStudio();
  const [tab, setTab] = useState("manual");
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
  const [plan, setPlan] = useState({
    title: "每日原创故事",
    time: "09:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
    candidateLimit: 2,
    finishedGoal: 1,
    costLimit: 0,
    enabled: false,
    checkpoints: policy,
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
    if (tab === "manual") {
      const r = await call("creation.start", {
        artistId: artist,
        title: form.title,
        story: form.story,
        overrides: overrides(),
      });
      go("track", r.workId);
      notify("已创建本地歌词与提示词，音频等待生成后导入。");
    } else {
      await call("plan.save", {
        ...plan,
        artistId: artist,
        story: form.story,
        overrides: overrides(),
      });
      notify("每日计划已保存；只有客户端打开时调度。");
    }
  };
  return (
    <>
      <PageHead
        title="把灵感写成一首歌"
        sub="从一个故事开始，沿着自己的声音慢慢创作。"
      />
      <div className="tabs">
        <button
          className={tab === "manual" ? "active" : ""}
          onClick={() => setTab("manual")}
        >
          手动创作
        </button>
        <button
          className={tab === "daily" ? "active" : ""}
          onClick={() => setTab("daily")}
        >
          每日创作计划
        </button>
      </div>
      <div className="split">
        <form
          className="panel"
          onSubmit={(e) => {
            void submit(e).catch(() => {});
          }}
        >
          <div className="section-title">
            <h2>{tab === "manual" ? "01 / 创作设定" : "01 / 计划设定"}</h2>
            <Badge>可覆盖艺人默认值</Badge>
          </div>
          <SelectArtist value={artist} onChange={setArtist} />
          {tab === "manual" ? (
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
          ) : (
            <label>
              计划名称
              <input
                required
                value={plan.title}
                onChange={(e) => setPlan({ ...plan, title: e.target.value })}
              />
            </label>
          )}
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
          <h3>02 / 你的故事</h3>
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
          {tab === "daily" && (
            <>
              <div className="form-grid">
                <label>
                  每日时间
                  <input
                    type="time"
                    required
                    value={plan.time}
                    onChange={(e) => setPlan({ ...plan, time: e.target.value })}
                  />
                </label>
                <label>
                  IANA 时区
                  <input
                    required
                    value={plan.timezone}
                    onChange={(e) =>
                      setPlan({ ...plan, timezone: e.target.value })
                    }
                  />
                </label>
                <label>
                  候选上限
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={plan.candidateLimit}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        candidateLimit: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  成品目标
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={plan.finishedGoal}
                    onChange={(e) =>
                      setPlan({ ...plan, finishedGoal: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  生成费用上限（元，仅计划值）
                  <input
                    type="number"
                    min="0"
                    value={plan.costLimit / 100}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        costLimit: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </label>
                <label>
                  状态
                  <select
                    value={String(plan.enabled)}
                    onChange={(e) =>
                      setPlan({ ...plan, enabled: e.target.value === "true" })
                    }
                  >
                    <option value="false">先保存为暂停</option>
                    <option value="true">启用本地计划</option>
                  </select>
                </label>
              </div>
              <h3>工作流确认点</h3>
              <div className="form-grid">
                {[
                  ["lyrics", "歌词确认"],
                  ["candidate", "候选选择"],
                  ["cover", "封面确认"],
                  ["finished", "成品确认"],
                ].map(([k, n]) => (
                  <label key={k}>
                    {n}
                    <select
                      value={(plan.checkpoints as any)[k]}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          checkpoints: {
                            ...plan.checkpoints,
                            [k]: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="manual">人工确认</option>
                      <option value="automatic">本地条件满足后自动</option>
                    </select>
                  </label>
                ))}
              </div>
              <Badge>发布前人工确认 · 首版强制开启</Badge>
            </>
          )}
          <div className="button-row">
            <button className="primary" type="submit">
              {tab === "manual" ? "生成本地歌词与提示词 →" : "保存每日计划"}
            </button>
          </div>
        </form>
        <div>
          <section className="panel">
            <h2>从灵感到作品</h2>
            <ol className="workflow-list">
              <li>
                <b>写下故事</b>
                <p>本地模板辅助起草歌词与提示词，可以继续编辑、保存版本。</p>
              </li>
              <li>
                <b>生成后导入</b>
                <p>
                  Suno / 谱乐真实生成尚未接入。到官方页面操作后导入自己的音频。
                </p>
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
              </li>
              <li>
                <b>完成封面与素材</b>
                <p>Codex 协作任务、本地图片导入和歌名艺名排版。</p>
              </li>
              <li>
                <b>认真确认，再去发布</b>
                <p>预检版本、身份、权益、额度和材料。不会自动真实投稿。</p>
              </li>
            </ol>
          </section>
          {tab === "daily" && (
            <section className="panel">
              <h2>
                已保存计划 <Badge>{data.plans.length}</Badge>
              </h2>
              <div className="notice">
                客户端关闭时不运行；错过的计划不会自动收费追补。开启计划不授予付费生成或发布权限。
              </div>
              {data.plans.map((p: any) => (
                <div className="plan-item" key={p.id}>
                  <h3>
                    {p.title} <Badge>{p.enabled ? "已启用" : "已暂停"}</Badge>
                  </h3>
                  <p>
                    {p.timezone} · {p.time} · 目标 {p.finishedGoal} 首 / 候选{" "}
                    {p.candidateLimit}
                  </p>
                  <small>下次：{date(p.next[0])}</small>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        call("plan.toggle", { id: p.id, enabled: !p.enabled })
                      }
                    >
                      {p.enabled ? "暂停" : "启用"}
                    </button>
                    <button onClick={() => call("plan.run", { id: p.id })}>
                      手动运行一次
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <section className="panel">
            <h2>创作任务</h2>
            {data.runs
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
