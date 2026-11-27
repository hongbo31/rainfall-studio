import React, { useEffect, useId, useMemo, useState } from "react";
import { publicationPlatforms } from "../../shared/platform-config";
import { publicationHistoryStatuses, type PublicationHistoryPage, type PublicationHistoryPlatform, type PublicationHistoryQuery, type PublicationHistoryRow, type PublicationHistoryStatus } from "../../shared/publication-history";
import { Badge, names, useStudioRequest } from "../context";
import "../publication-history.css";

const statuses: Record<PublicationHistoryStatus, string> = {
  contract_pending: "待授权",
  submitted: "已投稿",
  reviewing: "审核中",
  published: "已上架",
  rejected: "审核未通过",
  withdrawn: "已下架",
};
const platforms = [...publicationPlatforms, { id: "tme", label: names.tme }] as const;
type LoadedPage = { query: PublicationHistoryQuery; value: PublicationHistoryPage };
type SearchField = "title" | "singer" | "promptEngine";

const searchFields: { field: SearchField; label: string }[] = [
  { field: "title", label: "歌名" },
  { field: "singer", label: "歌手" },
  { field: "promptEngine", label: "提示词引擎" },
];

export default function PublicationHistory() {
  const headingId = useId();
  const request = useStudioRequest();
  const [query, setQuery] = useState<PublicationHistoryQuery>({ page: 1 });
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [error, setError] = useState<PublicationHistoryQuery | null>(null);
  const [revision, setRevision] = useState(0);
  const data = loaded?.query === query ? loaded.value : null;
  const groups = useMemo(() => {
    const days = new Map<string | null, PublicationHistoryRow[]>();
    for (const row of data?.rows ?? []) {
      const group = days.get(row.day) ?? [];
      group.push(row);
      days.set(row.day, group);
    }
    return [...days];
  }, [data]);
  const page = query.page ?? 1;
  const totalPages = Math.max(1, data ? Math.ceil(data.total / data.pageSize) : 1);
  const change = (filter: Partial<PublicationHistoryQuery>) => setQuery(previous => ({ ...previous, ...filter, page: 1 }));

  useEffect(() => {
    let active = true, reading = false;
    const load = async () => {
      if (!active || reading || document.hidden) return;
      reading = true;
      try {
        const value: PublicationHistoryPage = await request("publish.history", query);
        if (active) {
          setLoaded({ query, value });
          setError(null);
        }
      } catch {
        if (active) setError(query);
      } finally {
        reading = false;
      }
    };
    const debounce = window.setTimeout(load, 200);
    const timer = window.setInterval(load, 8_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [request, query, revision]);

  return (
    <section className="panel publication-history" aria-labelledby={headingId}>
      <div className="publication-history-heading">
        <h2 id={headingId}>歌曲上传记录</h2>
        <button type="button" onClick={() => setRevision(value => value + 1)}>刷新记录</button>
      </div>
      <div className="publication-history-filters">
        <label>
          上传日期（北京时间）
          <input type="date" value={query.day ?? ""} onChange={event => change({ day: event.target.value || undefined })} />
        </label>
        <label>
          <span id={headingId + "-platform"}>发布平台</span>
          <select aria-labelledby={headingId + "-platform"} value={query.platform ?? ""}
            onChange={event => change({ platform: (event.target.value || undefined) as PublicationHistoryPlatform | undefined })}>
            <option value="">全部平台</option>
            {platforms.map(platform => <option key={platform.id} value={platform.id}>{platform.label}</option>)}
          </select>
        </label>
        {searchFields.map(({ label, field }) => (
          <label key={field}>
            {label}
            <input type="search" maxLength={500} value={query[field] ?? ""} onChange={event => change({ [field]: event.target.value })} />
          </label>
        ))}
        <label>
          <span id={headingId + "-status"}>发布状态</span>
          <select aria-labelledby={headingId + "-status"} value={query.status ?? ""}
            onChange={event => change({ status: (event.target.value || undefined) as PublicationHistoryStatus | undefined })}>
            <option value="">全部状态</option>
            {publicationHistoryStatuses.map(status => <option key={status} value={status}>{statuses[status]}</option>)}
          </select>
        </label>
      </div>
      <div className="publication-history-heading publication-history-summary">
        <p role="status">{data ? `共 ${data.total.toLocaleString("zh-CN")} 条上传记录` :
          error !== query ? "正在读取发布记录…" : ""}</p>
        <div className="button-row">
          <button type="button" disabled={!loaded?.value.today || query.day === loaded?.value.today}
            onClick={() => change({ day: loaded?.value.today })}>今天</button>
          <button type="button" onClick={() => setQuery({ page: 1 })}>清空筛选</button>
        </div>
      </div>
      {error === query && <p role="alert">读取发布记录失败，请刷新重试。</p>}
      {data && (data.total > 0 && groups.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">歌曲</th>
                <th scope="col">发布平台</th>
                <th scope="col">歌手</th>
                <th scope="col">提示词引擎</th>
                <th scope="col">状态</th>
                <th scope="col">时间</th>
              </tr>
            </thead>
            {groups.map(([day, songs]) => (
              <tbody key={day ?? "unknown"}>
                <tr className="publication-history-day">
                  <th colSpan={6} scope="rowgroup">{day ?? "日期待核对"}</th>
                </tr>
                {songs.map(song => (
                  <tr key={song.id}>
                    <td>{song.title}</td>
                    <td>
                      {names[song.platform]}
                      {!!song.destinations?.length && <small>{song.destinations.map(target => names[target]).join("、")}</small>}
                      {song.accountName && <small>{song.accountName}</small>}
                    </td>
                    <td>{song.singer ?? "—"}</td>
                    <td>{song.promptEngine ?? "—"}</td>
                    <td><Badge>{statuses[song.status]}</Badge>{song.source === "user" && <small>用户记录</small>}</td>
                    <td>
                      {song.time ?? "—"}
                      {song.timeSource === "recorded" && <small>记录时间</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : <div className="empty">{data.total ? "当前页暂无记录" : "当前筛选暂无上传记录"}</div>)}
      {(page > 1 || totalPages > 1) && <nav aria-label="上传记录分页" className="publication-history-pages button-row">
        <button type="button" disabled={page === 1} onClick={() => setQuery({ ...query, page: page - 1 })}>上一页</button>
        {page > totalPages ?
          <button type="button" onClick={() => setQuery({ ...query, page: 1 })}>回到第一页</button> :
          <span>第 {page} / {totalPages} 页</span>}
        <button type="button" disabled={page >= totalPages} onClick={() => setQuery({ ...query, page: page + 1 })}>下一页</button>
      </nav>}
    </section>
  );
}
