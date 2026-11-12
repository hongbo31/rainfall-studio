import HelpNote from "../components/HelpNote";
import React, { useEffect, useMemo, useState } from "react";
import { useStudio, PageHead, Badge, names } from "../context";
import { fanqieChoices, fanqieScope } from "../fanqie-accounts";
import { defaultFanqieAccountId } from "../../shared/platform-accounts";
import { maxPublicationWorks } from "../../shared/platform-config";
import {
  libraryPublicationIndex,
  type FanqiePublicationJob,
} from "../publication-status";
import "../library.css";

export default function Library() {
  const {
    data,
    go,
    play,
    selected,
    setSelected,
    call,
    notify,
    publishSelection,
    setPublishSelection,
  } = useStudio();
  const [search, setSearch] = useState(""),
    [artist, setArtist] = useState(""),
    [filter, setFilter] = useState("all");
  const [seriesTitle, setSeriesTitle] = useState(""),
    [seriesStory, setSeriesStory] = useState("");
  const [openingPublish, setOpeningPublish] = useState(false);
  const [fanqieHistory, setFanqieHistory] = useState<{
    scope: string;
    jobs: FanqiePublicationJob[];
    complete: boolean;
  }>();
  const fanqieAccountIds = [
    ...new Set([
      defaultFanqieAccountId,
      ...fanqieChoices(data.accounts ?? []).map(({ value }) => value),
    ]),
  ]
    .sort()
    .join(",");
  const live = data.mode === "production";
  useEffect(() => {
    if (!live || !window.rainfall?.fanqieUpload) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const latest: FanqiePublicationJob[][] = [];
    const load = async () => {
      const results = await Promise.allSettled([
        window.rainfall.call("planCenter.fanqieStatus"),
        ...fanqieAccountIds
          .split(",")
          .map((id) =>
            window.rainfall.fanqieUpload(
              "status",
              fanqieScope(id === defaultFanqieAccountId ? undefined : id),
            ),
          ),
      ]);
      if (stopped) return;
      const received = results.map((result, i) => {
        if (result.status !== "fulfilled" || !result.value.ok) return false;
        const jobs = i === 0 ? result.value.value : result.value.value.jobs;
        if (!Array.isArray(jobs)) return false;
        latest[i] = jobs;
        return true;
      });
      setFanqieHistory({
        scope: fanqieAccountIds,
        jobs: latest.flat(),
        complete: received.every(Boolean),
      });
      timer = setTimeout(load, 15000);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [live, fanqieAccountIds]);

  const currentHistory =
    live && fanqieHistory?.scope === fanqieAccountIds
      ? fanqieHistory
      : undefined;
  const { publicationPipelineJobs, externalTmePublications, tmeObservations } =
    data;
  const publicationIndex = useMemo(
    () =>
      libraryPublicationIndex(
        { publicationPipelineJobs, externalTmePublications, tmeObservations },
        currentHistory?.jobs ?? [],
      ),
    [
      publicationPipelineJobs,
      externalTmePublications,
      tmeObservations,
      currentHistory,
    ],
  );
  const artists = new Map<string, string>(
    data.artists.map((item: any) => [item.id, item.name]),
  );
  const assets = new Map<string, string>(
    (data.assets ?? []).map((item: any) => [item.id, item.kind]),
  );
  const workIds = new Set<string>(data.works.map((work: any) => work.id));
  const selectedIds = selected.filter((id) => workIds.has(id));
  const selectedSet = new Set(selectedIds);
  const audioSlot = (work: any) => {
    const preferred = work.selectedAudioVariant === "B" ? "audio_B" : "audio_A";
    const alternate = preferred === "audio_A" ? "audio_B" : "audio_A";
    return [preferred, alternate].find(
      (slot) => assets.get(work.assets?.[slot]) === "audio",
    );
  };
  const query = search.trim().toLocaleLowerCase();
  const works = data.works.filter(
    (w: any) =>
      (!query ||
        w.title.toLocaleLowerCase().includes(query) ||
        w.story?.toLocaleLowerCase().includes(query)) &&
      (!artist || w.artistId === artist) &&
      (filter === "all" ||
        (filter === "audio" ? !!audioSlot(w) : !audioSlot(w))),
  );
  const visibleIds = new Set<string>(works.map((work: any) => work.id));
  const allVisibleSelected =
    visibleIds.size > 0 && [...visibleIds].every((id) => selectedSet.has(id));
  const someVisibleSelected = selectedIds.some((id) => visibleIds.has(id));
  const updateSelection = (ids: string[]) => {
    if (ids.length > maxPublicationWorks) {
      notify(`单次最多选择 ${maxPublicationWorks} 首，请缩小筛选范围。`);
      return;
    }
    setSelected(ids);
  };
  const toggle = (id: string) =>
    updateSelection(
      selectedSet.has(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
    );
  const openPublish = async () => {
    setOpeningPublish(true);
    try {
      await setPublishSelection?.({
        workIds: selectedIds,
        targets: [],
        accountOverrides: publishSelection?.accountOverrides ?? {},
      });
      go("publish");
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法保存所选作品");
    } finally {
      setOpeningPublish(false);
    }
  };
  return (
    <>
      <PageHead
        title="作品库"
        action={
          <button className="primary" onClick={() => go("create")}>
            ＋ 新建作品
          </button>
        }
      />
      <section className="library-list" aria-label="作品列表">
        <div className="toolbar library-toolbar">
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
          <div className="library-actions">
            <span aria-live="polite">
              {selectedIds.length
                ? `已选 ${selectedIds.length} 首`
                : `共 ${works.length} 首`}
            </span>
            {selectedIds.length > 0 && (
              <button
                type="button"
                disabled={openingPublish}
                onClick={() => setSelected([])}
              >
                清空
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={!selectedIds.length || openingPublish}
              onClick={() => void openPublish()}
            >
              批量发布
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="library-table" aria-label="作品与平台发布状态">
            <thead>
              <tr>
                <th scope="col" className="library-check">
                  <input
                    type="checkbox"
                    aria-label="选择当前筛选的作品"
                    checked={allVisibleSelected}
                    disabled={!visibleIds.size || openingPublish}
                    ref={(node) => {
                      if (node)
                        node.indeterminate =
                          someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={() =>
                      updateSelection(
                        allVisibleSelected
                          ? selectedIds.filter((id) => !visibleIds.has(id))
                          : [...new Set([...selectedIds, ...visibleIds])],
                      )
                    }
                  />
                </th>
                <th scope="col">作品</th>
                <th scope="col">平台发布状态</th>
                <th scope="col" className="library-play">
                  试听
                </th>
              </tr>
            </thead>
            <tbody>
              {works.map((work: any) => {
                const statuses = publicationIndex.get(work.id);
                const slot = audioSlot(work);
                const checked = selectedSet.has(work.id);
                const cover = work.assets?.cover;
                return (
                  <tr
                    key={work.id}
                    className={checked ? "is-selected" : undefined}
                    data-work-id={work.id}
                  >
                    <td className="library-check">
                      <input
                        type="checkbox"
                        aria-label={"选择 " + work.title}
                        checked={checked}
                        disabled={openingPublish}
                        onChange={() => toggle(work.id)}
                      />
                    </td>
                    <td>
                      <div className="library-track">
                        {assets.get(cover) === "image" ? (
                          <img
                            className="library-cover"
                            src={"media://asset/" + cover}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span className="library-cover" aria-hidden="true">
                            ♫
                          </span>
                        )}
                        <div>
                          <button
                            type="button"
                            className="library-title"
                            onClick={() => go("track", work.id)}
                          >
                            {work.title}
                          </button>
                          <small>
                            {artists.get(work.artistId) ?? "未指定艺人"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {statuses?.size ? (
                        <ul className="library-statuses">
                          {[...statuses.values()].map(
                            ({ target, state, label }) => (
                              <li key={target} data-state={state}>
                                <b>{names[target] ?? target}</b>
                                <span>{label}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <span className="muted">
                          {!live || currentHistory?.complete
                            ? "暂无关联回执"
                            : currentHistory
                              ? "发布记录待核对"
                              : "读取中…"}
                        </span>
                      )}
                    </td>
                    <td className="library-play">
                      {slot ? (
                        <button
                          type="button"
                          aria-label={"试听 " + work.title}
                          onClick={() => play(work, slot)}
                        >
                          <span aria-hidden="true">▶</span>{" "}
                          {slot === "audio_B" ? "B" : "A"} 版
                        </button>
                      ) : (
                        <span className="muted">无音频</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!works.length && (
                <tr>
                  <td className="library-empty muted" colSpan={4}>
                    没有符合筛选的作品
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <details className="panel library-series">
        <summary>系列与专辑故事线</summary>
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
              workIds: selectedIds,
            });
            setSeriesTitle("");
            setSeriesStory("");
          }}
        >
          按当前选择顺序建立系列
        </button>
        <HelpNote label="曲序说明">
          先按顺序勾选作品，再保存曲序。现有系列和作品版本均保留。
        </HelpNote>
      </details>
    </>
  );
}
