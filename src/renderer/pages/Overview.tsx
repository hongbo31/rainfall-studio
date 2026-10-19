import HelpNote from "../components/HelpNote";
import React from "react";
import { useStudio, PageHead, WorkCard, Badge, label } from "../context";
export default function Overview() {
  const { data, go } = useStudio();
  const r = data.resources;
  return (
    <>
      <PageHead
        title="总览"
        action={
          <div className="button-row">
            {data.works.length ? <><button className="primary" onClick={() => go("chat")}>聊聊新想法</button><button onClick={() => go("create")}>用本地模板起草</button><button onClick={() => go("library")}>整理已有作品</button></> : <><button className="primary" onClick={() => go("create")}>创建第一首作品</button><button onClick={() => go("chat")}>先聊聊想法</button></>}
          </div>
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
          <HelpNote label="成品计数">版本和平台数量不重复计数。</HelpNote>
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
          <h2>{data.series[0]?.title || "系列与专辑"}</h2>
          {data.series[0]?.story && <p>{data.series[0].story}</p>}
          <button onClick={() => go("library")}>管理系列 ↗</button>
        </div>
        <div className="series-art">雨</div>
      </section>
      <div className="section-title">
        <h2>最近作品</h2>
        <button onClick={() => go("library")}>查看全部 →</button>
      </div>
      {data.works.length ? (
        <div className="work-grid">
          {data.works.slice(-3).map((w: any) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
      ) : (
        <div className="panel empty">暂无作品。可用本地模板新建。</div>
      )}
      <div className="split section-gap">
        <div className="panel">
          <h2>{"计划中心"}</h2>
          <button onClick={() => go("plans")}>{"管理计划与执行历史"}</button>
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
