import React, { useEffect, useState } from "react";
import { useStudio, names } from "../context";
import {
  platformTargets,
  type PublishSelection,
} from "../../shared/platform-config";
import type { MaterialWorkbenchSnapshot } from "../../shared/material-workbench";
import "../publication-workbench.css";
export const publicationStates = {
  unpublished: "未发布",
  reviewing: "审核中",
  published: "已发布",
  rejected: "已拒绝",
  unknown: "待核对",
};
export function publicationState(
  data: any,
  workId: string,
  target: string,
): keyof typeof publicationStates {
  const jobs = (data.publicationPipelineJobs ?? []).filter(
    (j: any) =>
      j.workId === workId && (j.targets ?? [j.target]).includes(target),
  );
  const job = jobs.at(-1);
  if (!job) return "unpublished";
  const task = job.task ?? job;
  if (
    ["reviewing", "published", "rejected"].includes(job.state) &&
    ["official", "official-tencent-review-record"].includes(
      task.receipt?.source,
    )
  )
    return job.state;
  if (
    [
      "reviewing",
      "published",
      "rejected",
      "reconcile_required",
      "unknown",
    ].includes(job.state)
  )
    return "unknown";
  return "unpublished";
}
export function readyVersions(data: any, work: any) {
  return (["A", "B"] as const).flatMap((version) => {
    const asset = (data.assets ?? []).find(
      (a: any) => a.id === work.assets?.["audio_" + version],
    );
    return asset?.kind === "audio" && asset.bytes > 0 && asset.sha256
      ? [{ version, asset }]
      : [];
  });
}
export default function PublicationMusicList({
  selection,
  onChange,
  query,
  busy,
  onVersionBusy,
}: {
  selection: PublishSelection;
  onChange: (s: PublishSelection) => void;
  query: string;
  busy: boolean;
  onVersionBusy: (value: boolean) => void;
}) {
  const { data, call, refresh, go } = useStudio();
  const [target, setTarget] = useState("qqmusic"),
    [state, setState] = useState("unpublished"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState("");
  const [materials, setMaterials] = useState<
    MaterialWorkbenchSnapshot | undefined
  >(data.materialWorkbench);
  useEffect(() => {
    let stopped = false;
    if (data.materialWorkbench) {
      setMaterials(data.materialWorkbench);
      return;
    }
    void call("materials.list")
      .then((value) => {
        if (!stopped) setMaterials(value);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [data.materialWorkbench, data.mode]);
  const works = (data.works ?? []).filter(
    (w: any) =>
      (state === "needs_attention"
        ? !readyVersions(data, w).length
        : readyVersions(data, w).length > 0) &&
      w.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (state === "all" ||
        state === "needs_attention" ||
        publicationState(data, w.id, target) === state),
  );
  const selectVersion = async (workId: string, version: string) => {
    setSaving(workId);
    onVersionBusy(true);
    setError("");
    try {
      await call("work.selectAudioVersion", {
        workId,
        version,
        expectedRevision: data.works.find((w: any) => w.id === workId)
          ?.revision,
      });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving("");
      onVersionBusy(false);
    }
  };
  return (
    <div className="publication-music-workbench">
      <div className="publication-music-filters">
        <label>
          平台状态
          <select
            aria-label="歌曲状态平台"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {platformTargets.map((t) => (
              <option key={t} value={t}>
                {names[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          发布状态
          <select
            aria-label="歌曲发布状态"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="all">全部音频状态</option>
            <option value="needs_attention">待补充音频素材</option>
            {Object.entries(publicationStates).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="simple-song-list">
        {works.map((work: any) => {
          const versions = readyVersions(data, work),
            material = materials?.materials.find(
              (m) =>
                m.workId === work.id ||
                m.versions.some((v) => v.workId === work.id),
            );
          const source = materials?.sources.find(
            (s) => s.id === material?.sourceId,
          );
          const chosen = work.selectedAudioVariant === "B" ? "B" : "A";
          const cover = (data.assets ?? []).find(
            (a: any) => a.id === work.assets?.cover,
          );
          return (
            <article
              className={
                "publication-music-row" +
                (selection.workIds.includes(work.id) ? " is-selected" : "")
              }
              key={work.id}
              data-work-id={work.id}
            >
              <label className="inline-check">
                <input
                  type="checkbox"
                  aria-label={"选择歌曲 " + work.title}
                  checked={selection.workIds.includes(work.id)}
                  onChange={() =>
                    onChange({
                      ...selection,
                      workIds: selection.workIds.includes(work.id)
                        ? selection.workIds.filter((id) => id !== work.id)
                        : [...selection.workIds, work.id],
                    })
                  }
                />
                <b>{work.title}</b>
              </label>
              <small>
                {data.artists?.find((a: any) => a.id === work.artistId)?.name ??
                  "未指定艺人"}{" "}
                · {names[target]}：
                {publicationStates[publicationState(data, work.id, target)]}
              </small>
              {cover?.kind === "image" && (
                <details className="publication-cover">
                  <summary>
                    <img
                      alt={work.title + " 封面缩略图"}
                      src={"media://asset/" + cover.id}
                    />
                    <span>
                      查看封面 · {cover.metadata?.width ?? "?"} ×{" "}
                      {cover.metadata?.height ?? "?"}
                    </span>
                  </summary>
                  <img
                    alt={work.title + " 发布封面"}
                    src={"media://asset/" + cover.id}
                  />
                  <small>作品已绑定封面 · {cover.label ?? cover.id}</small>
                </details>
              )}
              <label>
                发布版本
                <select
                  aria-label={work.title + " 发布版本"}
                  value={chosen}
                  disabled={busy || saving === work.id || !versions.length}
                  onChange={(e) => void selectVersion(work.id, e.target.value)}
                >
                  {(["A", "B"] as const).map((v) => (
                    <option
                      value={v}
                      key={v}
                      disabled={!versions.some((x) => x.version === v)}
                    >
                      {v} 版
                      {versions.some((x) => x.version === v)
                        ? ""
                        : "（无音频）"}
                    </option>
                  ))}
                </select>
              </label>
              <details className="publication-audio-details"><summary>试听与素材来源</summary>
              {versions.map(({ version, asset }) => (
                <div className="publication-audio-version" key={asset.id}>
                  <span>
                    {version} 版{chosen === version ? " · 用于发布" : ""}
                  </span>
                  <audio
                    controls
                    preload="none"
                    aria-label={work.title + " " + version + " 版试听"}
                    src={"media://asset/" + asset.id}
                    onError={() =>
                      setError(
                        work.title +
                          " " +
                          version +
                          " 版音频不可读取，请检查本地素材。",
                      )
                    }
                  />
                </div>
              ))}
              {material ? (
                <div className="publication-material-origin">
                  <small>
                    来源：{source?.root ?? material.sourceId} ·{" "}
                    {material.number} · 修订 {material.revision}
                  </small>
                  <button
                    type="button"
                    onClick={() => go("materials", material.id)}
                  >
                    生成历史 · {material.jobIds.length} 次
                  </button>
                </div>
              ) : (
                <small>来源：现有作品库</small>
              )}
              </details>
              <button
                type="button"
                className="text-button"
                onClick={() => go("track", work.id)}
              >
                查看素材
              </button>
            </article>
          );
        })}
      </div>
      {!works.length && (
        <p role="status">
          暂无符合条件的本地音频。生成任务或排队记录不代表音频已就绪。
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
