import React from "react";
import type { SimplePublicationRequest } from "../../shared/platform-config";
import { Badge, names } from "../context";

const aiNames: Record<string, string> = {
  generated: "AI生成",
  assisted: "AI辅助",
  none: "无AI生成声明",
  unknown: "AI来源待确认",
};
function duration(n?: number) {
  return n
    ? `${Math.floor(n / 60)
        .toString()
        .padStart(2, "0")}:${Math.round(n % 60)
        .toString()
        .padStart(2, "0")}`
    : "";
}
export default function PublicationMaterialResult({
  request: r,
  onTrack,
  onConfigure,
}: {
  request: SimplePublicationRequest;
  onTrack: () => void;
  onConfigure: () => void;
}) {
  const m = r.materialSnapshot,
    a = m?.audio,
    cover = m?.cover,
    lyrics = m?.lyrics,
    metadata = m?.metadata;
  const missingLyrics = !lyrics?.plainText?.trim();
  return (
    <article className="publication-material-result" data-request-id={r.id}>
      <div className="simple-request-heading">
        <h3>
          {r.title} · {names[r.target]}
        </h3>
        <Badge>
          {r.stale
            ? "资料已变化"
            : r.source === "simulation"
              ? "本地模拟"
              : "材料检查"}
        </Badge>
      </div>
      <p className="publication-submit-blocker">
        {r.source === "simulation"
          ? "本地模拟 · 未上传"
          : `暂不能提交：${r.submission?.reason ?? names[r.target].replace(/\s/g, "") + "上传未接通"}`}
      </p>
      {r.stale ? (
        <p>以下为上次材料快照，请重新检查。</p>
      ) : (
        <div className="publication-material-chips">
          <span>
            {a
              ? `音频 ${m?.recordingSlot === 'audio_B' ? 'B' : 'A'} · ${(a.format ?? a.mime?.split("/")[1] ?? "").toUpperCase()} ${duration(a.durationSeconds)}`
              : "缺少音频"}
          </span>
          <span>{missingLyrics ? "缺少歌词" : "歌词已准备"}</span>
          <span>{cover ? "封面已准备" : "缺少封面"}</span>
          <span>{aiNames[m?.ai ?? "unknown"] ?? "AI来源待确认"}</span>
        </div>
      )}
      <div className="publication-material-actions">
        {!a && <button onClick={onTrack}>补音频</button>}
        {missingLyrics && <button onClick={onTrack}>补歌词</button>}
        {!cover && <button onClick={onTrack}>补封面</button>}
        {!missingLyrics && !lyrics?.alignmentConfirmed && (
          <button onClick={onTrack}>核对歌词</button>
        )}
        {r.issues.some((v) => v.includes("权益") || v.includes("翻唱")) && (
          <button onClick={onTrack}>核对权属</button>
        )}
        {(!metadata?.lyricist || !metadata?.composer) && (
          <button onClick={onConfigure}>补署名</button>
        )}
        <button className="text-button" onClick={onConfigure}>
          配置 {names[r.target]}
        </button>
      </div>
      {!!r.issues.length && (
        <ul className="publication-material-issues">
          {r.issues
            .filter((v) => v !== m?.terms?.termsText)
            .map((v, i) => (
              <li key={i}>{v}</li>
            ))}
        </ul>
      )}
      <details className="publication-material-preview">
        <summary>查看已准备材料</summary>
        <dl>
          <dt>艺人</dt>
          <dd>{metadata?.artistName || "待设置"}</dd>
          <dt>词作者 / 曲作者</dt>
          <dd>
            {metadata?.lyricist || "待填写"} / {metadata?.composer || "待填写"}
          </dd>
          <dt>专辑</dt>
          <dd>{metadata?.album || "待填写"}</dd>
          <dt>语种 / 曲风</dt>
          <dd>
            {metadata?.language || "待填写"} / {metadata?.genre || "待填写"}
          </dd>
          <dt>账号</dt>
          <dd>{m?.account?.name || "待选择"}</dd>
          <dt>音频</dt>
          <dd>{a?.label || "未准备"}</dd>
          <dt>封面</dt>
          <dd>
            {cover
              ? `${cover.width ?? "?"} × ${cover.height ?? "?"}`
              : "未准备"}
          </dd>
          <dt>AI与来源</dt>
          <dd>
            {aiNames[m?.ai ?? "unknown"]} ·{" "}
            {m?.provenance?.statement || m?.rights || "待记录"}
          </dd>
        </dl>
        {!missingLyrics && (
          <label>
            发布歌词
            <textarea
              aria-label="发布歌词预览"
              readOnly
              value={lyrics!.plainText}
            />
          </label>
        )}
        {m?.terms && (
          <details>
            <summary>查看本次条款</summary>
            <pre>{m.terms.termsText}</pre>
          </details>
        )}
      </details>
    </article>
  );
}
