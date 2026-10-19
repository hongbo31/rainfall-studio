import HelpNote from "../components/HelpNote";
import React, { useState, useEffect } from "react";
import { useStudio, PageHead, Badge, names, date } from "../context";
import { summarizeReports, reportScopeKey } from "../insights-summary";
export default function Insights() {
  const { data, importAsset } = useStudio();
  const [platform, setPlatform] = useState(""),
    [period, setPeriod] = useState(""),
    [confirmedScope, setConfirmedScope] = useState<string | null>(null);
  const scope = { platform, date: period },
    scopeKey = reportScopeKey(data.metrics, scope);
  const summary = summarizeReports(data.metrics, {
      ...scope,
      basisConfirmed: confirmedScope === scopeKey,
    }),
    list = summary.rows;
  useEffect(() => setConfirmedScope(null), [scopeKey]);
  const hint =
    summary.status === "choose_date"
      ? "请选择统计日期"
      : summary.status === "choose_platform"
        ? "请选择一个统计平台"
        : summary.status === "no_reports"
          ? "当前筛选尚无报表 · 未同步"
          : summary.status === "confirm_basis"
            ? "请先核对指标口径"
            : null;
  return (
    <>
      <PageHead
        title="数据看板"
        action={
          <button className="primary" onClick={() => importAsset("report")}>
            ＋ 导入 CSV 报表
          </button>
        }
      />
      <p className="notice">用户导入报表 · 未自动同步 · 累计快照非增长</p>
      <HelpNote label="统计口径">
        在线统计尚未接入，数据不会自动同步。此页仅展示用户导入报表；选择同一日期、同一平台并核对指标口径后，才合计已知数值。累计快照不能跨日期相加解读为总增长。
      </HelpNote>
      <div className="toolbar">
        <select
          aria-label="统计平台"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="">全部平台</option>
          {Object.keys(names)
            .slice(0, 5)
            .map((k) => (
              <option key={k} value={k}>
                {names[k]}
              </option>
            ))}
        </select>
        <input
          type="date"
          aria-label="报表日期"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        <Badge>指标缺失显示 —</Badge>
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          aria-label="我已核对当前报表的指标口径一致"
          disabled={!period || !platform || !list.length}
          checked={confirmedScope === scopeKey}
          onChange={(e) =>
            setConfirmedScope(e.target.checked ? scopeKey : null)
          }
        />
        我已核对当前报表的指标口径一致
      </label>
      <div className="stats">
        <div>
          <small>当前筛选报表行</small>
          <strong>{list.length}</strong>
          <span>{hint || "按当前日期与平台筛选"}</span>
        </div>
        {(
          [
            ["plays", "播放"],
            ["favorites", "收藏"],
            ["comments", "评论"],
          ] as const
        ).map(([field, title]) => {
          const metric = summary.metrics[field];
          return (
            <div key={field} data-testid={"metric-" + field}>
              <small>{title} · 已知数据合计</small>
              <strong>
                {metric.value === null ? "—" : metric.value.toLocaleString()}
              </strong>
              {!hint&&<span>
                {(metric.overflow
                    ? "合计超出安全范围，请查看明细"
                    : metric.known === 0
                      ? "尚未导入此指标 · 未同步"
                      : `覆盖 ${metric.known}/${metric.total} 条 · 非增长`)}
              </span>}
            </div>
          );
        })}
      </div>
      <section className="panel">
        <h2>作品表现与来源</h2>
        {!list.length ? (
          <div className="empty">
            {data.metrics.length
              ? "当前筛选暂无报表"
              : "暂无报表"}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>作品 / 账号</th>
                  <th>平台</th>
                  <th>报表日期</th>
                  <th>播放</th>
                  <th>收藏</th>
                  <th>评论</th>
                  <th>来源 / 导入时间</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m: any) => (
                  <tr key={m.id}>
                    <td>
                      {m.work}
                      <small>{m.account}</small>
                    </td>
                    <td>{names[m.platform]}</td>
                    <td>{m.date}</td>
                    <td>{m.plays ?? "—"}</td>
                    <td>{m.favorites ?? "—"}</td>
                    <td>{m.comments ?? "—"}</td>
                    <td>
                      用户导入<small>{date(m.importedAt)}</small>
                      <small>{m.fileHash.slice(0, 12)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <details className="panel">
        <summary>CSV 导入格式</summary>
        <pre>
          platform,account,work,date,plays,favorites,comments{"\n"}
          netease,我的账号,原创作品,2026-10-15,100,,2
        </pre>
        <p>
          日期使用 YYYY-MM-DD；平台代码 netease / qishui / qqmusic / kugou /
          douyin。支持 UTF-8
          BOM、引号、逗号和换行。此行只是字段示例，不会自动写入统计。
        </p>
      </details>
    </>
  );
}
