import React, { useState } from "react";
import { useStudio, PageHead, Badge, names, date } from "../context";
export default function Insights() {
  const { data, importAsset } = useStudio();
  const [platform, setPlatform] = useState(""),
    [period, setPeriod] = useState("");
  const list = data.metrics.filter(
    (m: any) =>
      (!platform || m.platform === platform) && (!period || m.date === period),
  );
  const plays = list.reduce((n: number, m: any) => n + (m.plays ?? 0), 0),
    favorites = list.reduce((n: number, m: any) => n + (m.favorites ?? 0), 0),
    comments = list.reduce((n: number, m: any) => n + (m.comments ?? 0), 0);
  return (
    <>
      <PageHead
        title="把成长，看得更清楚。"
        sub="保留数据来源与观察时间，记录作品每一步真实的回响。"
        action={
          <button className="primary" onClick={() => importAsset("report")}>
            ＋ 导入 CSV 报表
          </button>
        }
      />
      <div className="notice">
        在线统计尚未接入。此页仅展示已导入报表；累计快照按账号、作品和日期替换，不能跨日期相加解读为总增长。
      </div>
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
      <div className="stats">
        <div>
          <small>当前筛选报表行</small>
          <strong>{list.length}</strong>
          <span>包含不同日期快照</span>
        </div>
        <div>
          <small>播放快照合计</small>
          <strong>{plays.toLocaleString()}</strong>
          <span>仅当前行；非去重增长</span>
        </div>
        <div>
          <small>收藏快照合计</small>
          <strong>{favorites.toLocaleString()}</strong>
          <span>缺失项不补造</span>
        </div>
        <div>
          <small>评论快照合计</small>
          <strong>{comments.toLocaleString()}</strong>
          <span>以原报表口径为准</span>
        </div>
      </div>
      <section className="panel">
        <h2>作品表现与来源</h2>
        {!list.length ? (
          <div className="empty">
            还没有导入数据。准备一份自己的平台报表，或按下方格式整理 CSV。
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
      <section className="panel">
        <h2>CSV 导入格式</h2>
        <pre>
          platform,account,work,date,plays,favorites,comments{"\n"}
          netease,我的账号,原创作品,2026-10-15,100,,2
        </pre>
        <p>
          日期使用 YYYY-MM-DD；平台代码 netease / qishui / qqmusic / kugou /
          douyin。支持 UTF-8
          BOM、引号、逗号和换行。此行只是字段示例，不会自动写入统计。
        </p>
      </section>
    </>
  );
}
