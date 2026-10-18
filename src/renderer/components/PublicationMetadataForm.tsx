import React, { useId, useRef, useState } from "react";
import { useStudio } from "../context";

const labels: Record<string, string> = {
  albumTitle: "专辑名",
  albumDescription: "专辑介绍",
  artistName: "艺人署名",
  lyricist: "词作者",
  composer: "曲作者",
  ownLyrics: "我是作词人",
  ownComposition: "我是作曲人",
  aiTool: "AI 工具",
  generatedOn: "生成日期",
  allowCover: "允许翻唱",
  genre: "曲风",
  language: "语言",
};
const inheritedAlbumNote = "沿用已有专辑，不修改原专辑资料。";
const booleanFields = ["ownLyrics", "ownComposition", "allowCover"];
export function publicationMetadataDefaults(
  work: any,
  data: any,
): Record<string, string> {
  const saved = work.publicationMetadata ?? work.metadata ?? {};
  const config =
    (data.platformConfigurations ?? []).find(
      (c: any) => c.target === "qqmusic",
    ) ??
    (data.platformConfigurations ?? []).find(
      (c: any) => c.target === "kugou",
    ) ??
    {};
  const artist = (data.artists ?? []).find(
    (a: any) => a.id === (work.artistId ?? config.artistId),
  );
  const text = (key: string, fallback = "") =>
    typeof saved[key] === "string" && saved[key].trim()
      ? saved[key]
      : typeof work[key] === "string" && work[key].trim()
        ? work[key]
        : fallback;
  const bool = (key: string, alias?: string) =>
    typeof saved[key] === "boolean"
      ? String(saved[key])
      : alias && typeof saved[alias] === "boolean"
        ? String(saved[alias])
        : typeof work[key] === "boolean"
          ? String(work[key])
          : "";
  const albumMode = text("albumMode", Object.keys(saved).length ? "" : "existing");
  return {
    albumMode,
    albumTitle: text(
      "albumTitle",
      text("album", config.album || work.title || ""),
    ),
    albumDescription: text("albumDescription", albumMode === "existing" ? inheritedAlbumNote : ""),
    artistName: text("artistName", artist?.name ?? ""),
    lyricist: text("lyricist", config.lyricist ?? ""),
    composer: text("composer", config.composer ?? ""),
    ownLyrics: bool("ownLyrics", "ownLyricist"),
    ownComposition: bool("ownComposition", "ownComposer"),
    aiTool: text("aiTool"),
    generatedOn: text("generatedOn"),
    allowCover: bool("allowCover"),
    genre: text("genre", work.config?.genre || config.genre || ""),
    language: text("language", work.config?.language || config.language || ""),
    version: "完整版",
    releaseMode: "审核通过即发布",
  };
}
export const metadataLocked = (job: any) =>
  !!job.dispatchedAt ||
  job.reason === "PROTECTED_PUBLISHED_WORK" ||
  ![
    "needs_configuration",
    "needs_materials",
    "queued",
    "awaiting_authorization",
    "blocked",
  ].includes(job.state);
type SaveInput = {
  work: any;
  job: any;
  metadata: Record<string, string>;
  expectedRevision: number;
  call: (method: string, input: any) => Promise<any>;
  refresh: () => Promise<void>;
};
export async function savePublicationMetadata({
  work,
  job,
  metadata,
  expectedRevision,
  call,
  refresh,
}: SaveInput) {
  if (work.revision !== expectedRevision)
    throw Error("作品已更新，请载入最新资料");
  if (metadataLocked(job)) throw Error("材料已开始处理，暂不能修改");
  const missing = Object.keys(labels).filter((key) =>
    booleanFields.includes(key)
      ? !["true", "false"].includes(metadata[key])
      : !metadata[key]?.trim(),
  );
  if (missing.length)
    throw Error("请补齐：" + missing.map((key) => labels[key]).join("、"));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(metadata.generatedOn) ||
    !Number.isFinite(Date.parse(metadata.generatedOn)) ||
    new Date(metadata.generatedOn).toISOString().slice(0, 10) !==
      metadata.generatedOn ||
    metadata.generatedOn > new Date().toISOString().slice(0, 10)
  )
    throw Error("请填写真实生成日期");
  const payload: Record<string, string | boolean> = {
    version: "完整版",
    releaseMode: "审核通过即发布",
  };
  if (metadata.albumMode) {
    if (!["existing", "new"].includes(metadata.albumMode)) throw Error("请选择专辑方式");
    payload.albumMode = metadata.albumMode;
  }
  for (const key of Object.keys(labels))
    payload[key] = booleanFields.includes(key)
      ? metadata[key] === "true"
      : metadata[key].trim();
  await call("publish.metadata.save", {
    workId: work.id,
    expectedRevision,
    metadata: payload,
  });
  await refresh();
}
export default function PublicationMetadataForm({
  work,
  data,
  job,
}: {
  work: any;
  data: any;
  job: any;
}) {
  const studio = useStudio();
  const id = useId();
  const [metadata, setMetadata] = useState(() =>
    publicationMetadataDefaults(work, data),
  );
  const [revision, setRevision] = useState(work.revision);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stale = work.revision !== revision;
  const disabled = busy || stale || metadataLocked(job) || !studio;
  const account = (data.accounts ?? []).find(
    (a: any) => a.id === job.accountId,
  );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePublicationMetadata({
        work,
        job,
        metadata,
        expectedRevision: revision,
        call: studio.call,
        refresh: studio.refresh,
      });
      setMessage("资料已保存");
    } catch (e: any) {
      setError(
        /REVISION|STALE/.test(e.message)
          ? "作品已更新，请载入最新资料"
          : /DISPATCH|RECONCILIATION|PROTECTED/.test(e.message)
            ? "材料已开始处理，暂不能修改"
            : e.message?.startsWith("请")
              ? e.message
              : "保存失败，请刷新后重试",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <details className="publication-metadata-form">
      <summary>投稿资料</summary>
      <p>
        {work.title} · {account?.name ?? "未配置账号"}
        {job.accountId ? `（${job.accountId}）` : ""}
      </p>
      <form onSubmit={(event) => void save(event)}>
        <fieldset
          disabled={disabled}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
            }}
          >
            <label htmlFor={id + "-albumMode"} style={{ display: "grid", gap: 4 }}>
              专辑方式
              <select id={id + "-albumMode"} value={metadata.albumMode} onChange={(e) => {
                const albumMode = e.target.value;
                setMetadata({ ...metadata, albumMode, albumDescription: albumMode === "existing" ? (metadata.albumDescription || inheritedAlbumNote) : metadata.albumDescription === inheritedAlbumNote ? "" : metadata.albumDescription });
              }}>
                {!metadata.albumMode && <option value="">沿用原有设置</option>}
                <option value="existing">选择已发行专辑</option>
                <option value="new">新建专辑</option>
              </select>
            </label>
            {Object.entries(labels).map(([key, label]) => (
              <label
                key={key}
                htmlFor={`${id}-${key}`}
                style={{ display: "grid", gap: 4 }}
              >
                {key === "albumDescription" && metadata.albumMode === "existing" ? "本地专辑备注" : label}
                {booleanFields.includes(key) ? (
                  <select
                    id={`${id}-${key}`}
                    required
                    value={metadata[key]}
                    onChange={(e) =>
                      setMetadata({ ...metadata, [key]: e.target.value })
                    }
                  >
                    <option value="">请选择</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                ) : key === "albumDescription" ? (
                  <textarea
                    id={`${id}-${key}`}
                    required
                    maxLength={10000}
                    rows={2}
                    value={metadata[key]}
                    onChange={(e) =>
                      setMetadata({ ...metadata, [key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    id={`${id}-${key}`}
                    type={key === "generatedOn" ? "date" : "text"}
                    max={
                      key === "generatedOn"
                        ? new Date().toISOString().slice(0, 10)
                        : undefined
                    }
                    required
                    maxLength={1000}
                    value={metadata[key]}
                    onChange={(e) =>
                      setMetadata({ ...metadata, [key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          {metadata.albumMode === "existing" && <p>选择已发行专辑将沿用原封面，不修改原专辑封面或资料。本地备注不会发送为专辑简介。</p>}
          <p>完整版 · 审核通过即发布</p>
          <button type="submit" disabled={disabled}>
            {busy ? "保存中…" : "保存资料"}
          </button>
        </fieldset>
        {stale && (
          <button
            type="button"
            disabled={busy || metadataLocked(job)}
            onClick={() => {
              setMetadata(publicationMetadataDefaults(work, data));
              setRevision(work.revision);
              setError("");
              setMessage("");
            }}
          >
            载入最新资料
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {stale && !message && <p role="status">作品已更新，请载入最新资料</p>}
      </form>
    </details>
  );
}
