import HelpNote from "../components/HelpNote";
import React, { useState } from "react";
import { useStudio, PageHead, WorkCard, Badge, label } from "../context";
import { accountSupportsTarget, type PlatformAccount } from "../../shared/platform-accounts";
import { platformTargets } from "../../shared/platform-config";
export default function Overview() {
  const { data, go, call, selected } = useStudio();
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesStory, setSeriesStory] = useState("");
  const [savingSeries, setSavingSeries] = useState(false);
  const [seriesError, setSeriesError] = useState("");
  const workTitles = new Map<string, string>(data.works.map((work: { id: string; title: string }) => [work.id, work.title]));
  const seriesWorkIds = (selected ?? []).filter(id => workTitles.has(id));
  const saveSeries = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingSeries || !seriesTitle.trim()) return;
    setSavingSeries(true);
    setSeriesError("");
    try {
      await call("series.save", { title: seriesTitle.trim(), story: seriesStory, workIds: seriesWorkIds });
      setSeriesTitle("");
      setSeriesStory("");
    } catch (error) {
      setSeriesError(error instanceof Error ? error.message : "无法保存系列");
    } finally {
      setSavingSeries(false);
    }
  };
  const r = data.resources;
  const needsPublicationAccount =
    data.mode === "production" &&
    !(data.accounts ?? []).some((account: PlatformAccount) =>
      platformTargets.some((target) => accountSupportsTarget(account.provider, target)),
    );
  const createButtonClass = needsPublicationAccount ? undefined : "primary";
  return (
    <>
      <PageHead
        title="总览"
        action={
          <div className="button-row">
            {needsPublicationAccount && (
              <button className="primary" onClick={() => go("platform-accounts")}>绑定平台账号</button>
            )}
            <button className={createButtonClass} onClick={() => go("chat")}>
              {data.works.length ? "聊聊新想法" : "创建第一首作品"}
            </button>
            {data.works.length > 0 && (
              <button onClick={() => go("chat")}>整理已有作品</button>
            )}
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
        </div>
        <div className="series-art">雨</div>
      </section>
      <details className="panel">
        <summary>管理系列</summary>
        {data.series.map((series: { id: string; title: string; story?: string; workIds: string[] }) => (
          <div className="row" key={series.id}>
            <div><b>{series.title}</b>{series.story && <small>{series.story}</small>}
              <p>{series.workIds.map(id => workTitles.get(id)).filter(Boolean).join(" → ")}</p></div>
            <Badge>{series.workIds.length} 首</Badge>
          </div>
        ))}
        <form onSubmit={event => void saveSeries(event)}>
          <div className="form-grid">
            <label>新系列 / 专辑名<input value={seriesTitle} required onChange={event => setSeriesTitle(event.target.value)} /></label>
            <label>故事线<input value={seriesStory} onChange={event => setSeriesStory(event.target.value)} /></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => go("chat")}>选择作品</button>
            <span>{seriesWorkIds.length ? seriesWorkIds.map(id => workTitles.get(id)).join(" → ") : "已选 0 首"}</span>
            <button type="submit" disabled={savingSeries || !seriesTitle.trim()}>按当前选择顺序建立系列</button>
          </div>
          {seriesError && <p role="alert">{seriesError}</p>}
        </form>
      </details>
      <div className="section-title">
        <h2>最近作品</h2>
        <button onClick={() => go("chat")}>查看全部 →</button>
      </div>
      {data.works.length ? (
        <div className="work-grid">
          {data.works.slice(-3).map((w: any) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
      ) : (
        <div className="panel empty">暂无作品。</div>
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
