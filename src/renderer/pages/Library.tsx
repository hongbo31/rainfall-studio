import React, { useState } from "react";
import { useStudio, PageHead, WorkCard, Badge } from "../context";
export default function Library() {
  const { data, go, selected, setSelected, call } = useStudio();
  const [search, setSearch] = useState(""),
    [artist, setArtist] = useState(""),
    [filter, setFilter] = useState("all");
  const [seriesTitle, setSeriesTitle] = useState(""),
    [seriesStory, setSeriesStory] = useState("");
  const works = data.works.filter(
    (w: any) =>
      (!search || w.title.includes(search) || w.story.includes(search)) &&
      (!artist || w.artistId === artist) &&
      (filter === "all" ||
        (filter === "audio" ? !!w.assets.audio_A : !w.assets.audio_A)),
  );
  const toggle = (id: string) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  return (
    <>
      <PageHead
        title="每一首，都有自己的来处。"
        sub="音频、歌词、封面和每一次修改，留在同一个作品里。"
        action={
          <button className="primary" onClick={() => go("create")}>
            ＋ 新作品
          </button>
        }
      />
      <div className="toolbar">
        <input
          aria-label="搜索作品"
          placeholder="搜索歌名或故事…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="筛选艺人"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        >
          <option value="">全部艺人</option>
          {data.artists.map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="筛选素材"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部素材状态</option>
          <option value="audio">已有音频</option>
          <option value="missing">缺少音频</option>
        </select>
        <button
          onClick={() =>
            setSelected(
              works.every((w: any) => selected.includes(w.id))
                ? selected.filter((id) => !works.some((w: any) => w.id === id))
                : [...new Set([...selected, ...works.map((w: any) => w.id)])],
            )
          }
        >
          选择当前筛选
        </button>
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <span>
            已选择 <b>{selected.length}</b> 首 <Badge>阻塞项会保留原因</Badge>
          </span>
          <button className="primary" onClick={() => go("publish")}>
            准备批量发布 →
          </button>
          <button onClick={() => setSelected([])}>清空选择</button>
        </div>
      )}
      <div className="work-grid">
        {works.map((w: any) => (
          <div
            key={w.id}
            className={
              "selectable " + (selected.includes(w.id) ? "selected" : "")
            }
          >
            <label className="select-check">
              <input
                type="checkbox"
                aria-label={"选择 " + w.title}
                checked={selected.includes(w.id)}
                onChange={() => toggle(w.id)}
              />
            </label>
            <WorkCard work={w} />
          </div>
        ))}
      </div>
      {!works.length && <div className="empty panel">没有符合筛选的作品。</div>}
      <section className="panel">
        <h2>系列与专辑故事线</h2>
        {data.series.map((s: any) => (
          <div className="row" key={s.id}>
            <div>
              <b>{s.title}</b>
              <small>{s.story}</small>
              <p>
                {s.workIds
                  .map(
                    (id: string) =>
                      data.works.find((w: any) => w.id === id)?.title,
                  )
                  .filter(Boolean)
                  .join(" → ")}
              </p>
            </div>
            <Badge>{s.workIds.length} 首</Badge>
          </div>
        ))}
        <div className="form-grid">
          <label>
            新系列 / 专辑名
            <input
              value={seriesTitle}
              onChange={(e) => setSeriesTitle(e.target.value)}
              placeholder="例如：刚好是你"
            />
          </label>
          <label>
            故事线
            <input
              value={seriesStory}
              onChange={(e) => setSeriesStory(e.target.value)}
              placeholder="相识 → 熟悉 → 告白"
            />
          </label>
        </div>
        <button
          disabled={!seriesTitle}
          onClick={async () => {
            await call("series.save", {
              title: seriesTitle,
              story: seriesStory,
              workIds: selected,
            });
            setSeriesTitle("");
            setSeriesStory("");
          }}
        >
          按当前选择顺序建立系列
        </button>
        <p>先按顺序勾选作品，再保存曲序。现有系列和作品版本均保留。</p>
      </section>
    </>
  );
}
