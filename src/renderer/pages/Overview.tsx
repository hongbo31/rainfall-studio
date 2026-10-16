import React from "react";
import { useStudio, PageHead, WorkCard, Badge, label } from "../context";
export default function Overview() {
  const { data, go } = useStudio();
  const r = data.resources;
  return (
    <>
      <PageHead
        title="让故事，成为下一首歌。"
        sub="从灵感到作品，再到每一次认真发布。今天也写一点心里的声音。"
        action={
          <button className="primary" onClick={() => go("create")}>
            ＋ 开始创作
          </button>
        }
      />
      <div className="stats">
        <div>
          <small>本地作品</small>
          <strong>
            {data.works.length}
            <em>首</em>
          </strong>
          <span>
            {data.works.filter((w: any) => w.assets.audio_A).length} 首已有音频
          </span>
        </div>
        <div>
          <small>成品目标进度</small>
          <strong>
            {r.finished}
            <em>首成品</em>
          </strong>
          <span>版本和平台数量不重复计数</span>
        </div>
        <div>
          <small>生成预算 · 本地上限</small>
          <strong>¥ {(r.cost.available / 100).toFixed(0)}</strong>
          <span>
            预占 ¥ {(r.cost.reserved / 100).toFixed(2)} · 平台余额未知
          </span>
        </div>
        <div>
          <small>今日候选预算</small>
          <strong>
            {r.candidate.available}
            <em>个可用</em>
          </strong>
          <span>
            已用 {r.candidate.spent} · 预占 {r.candidate.reserved}
          </span>
        </div>
      </div>
      <section className="series">
        <div>
          <div className="eyebrow">STORIES THAT BECOME SONGS</div>
          <h2>{data.series[0]?.title || "把下一章，写成音乐。"}</h2>
          <p>
            {data.series[0]?.story ||
              "建立系列或专辑，为每一首作品留下故事的来处。"}
          </p>
          <div className="storyline">
            相识 <i>────</i> 熟悉 <i>────</i> 告白
          </div>
          <button onClick={() => go("library")}>进入作品与故事线 ↗</button>
        </div>
        <div className="series-art">
          雨<span>EVERY STORY HAS A SOUND</span>
        </div>
      </section>
      <div className="section-title">
        <h2>
          最近的作品 <small>YOUR MUSIC, YOUR STORY</small>
        </h2>
        <button onClick={() => go("library")}>查看全部 →</button>
      </div>
      {data.works.length ? (
        <div className="work-grid">
          {data.works.slice(-3).map((w: any) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
      ) : (
        <div className="panel empty">
          作品库还是空白。创建一首作品，或切换到隔离的模拟演练查看原创故事样本。
        </div>
      )}
      <div className="split section-gap">
        <div className="panel">
          <h2>每日创作计划</h2>
          {data.plans.length ? (
            data.plans.slice(0, 3).map((p: any) => (
              <div className="row" key={p.id}>
                <div>
                  {p.title}
                  <small>
                    {p.timezone} · {p.time} ·{" "}
                    {p.enabled ? "已启用，需客户端打开" : "已暂停"}
                  </small>
                </div>
                <Badge>{p.finishedGoal} 首目标</Badge>
              </div>
            ))
          ) : (
            <p>
              让创作变成日常。开启计划后，本地准备按时执行；真实生成仍需合法接入与费用授权。
            </p>
          )}
          <button onClick={() => go("create")}>配置每日计划 →</button>
        </div>
        <div className="panel">
          <h2>
            待处理与异常 <Badge>{data.exceptions.length}</Badge>
          </h2>
          {data.exceptions.slice(0, 3).map((e: any) => (
            <div key={e.id} className="row">
              <div>
                {label(e.code)}
                <small>
                  远端结果：
                  {e.remoteOutcome === "unknown" ? "未知" : "未进行真实投稿"}
                </small>
              </div>
            </div>
          ))}
          {!data.exceptions.length && <p>目前没有待处理异常。</p>}
          <button onClick={() => go("publish")}>查看任务中心 →</button>
        </div>
      </div>
      <div className="capability-strip">
        <span>
          音乐生成 <Badge>官方生成后导入</Badge>
        </span>
        <span>
          AI 封面 <Badge>Codex 协作 / 本地导入</Badge>
        </span>
        <span>
          发布 <Badge>材料准备 / 模拟演练</Badge>
        </span>
        <span>
          统计 <Badge>CSV 导入</Badge>
        </span>
      </div>
    </>
  );
}
