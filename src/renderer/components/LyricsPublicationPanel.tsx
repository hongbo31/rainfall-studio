import HelpNote from "./HelpNote";
import React, { useEffect, useState } from "react";
import { useStudio, Badge } from "../context";
const sources: Record<string, string> = {
  manual: "用户编辑 / 导入",
  generation_input: "生成输入 · 演唱待核对",
  provider_actual: "提供方实际返回",
  legacy_unknown: "旧记录 · 来源未核实",
};
export function LyricsPublicationPanel({
  workId,
  beforeAction,
  onChanged,
}: {
  workId: string;
  beforeAction: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { data, call, importAsset, notify } = useStudio(),
    work = data.works.find((w: any) => w.id === workId);
  const [preview, setPreview] = useState<any>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const p = await call("lyrics.preview", { workId });
    setPreview(p);
    return p;
  };
  useEffect(() => {
    let active = true;
    setChecked(false);
    void call("lyrics.preview", { workId })
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    workId,
    work?.lyricsVersionId,
    work?.assets.audio_A,
    work?.lyricsConfirmation?.confirmedAt,
  ]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await beforeAction();
      await fn();
      await onChanged();
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="panel"
      id="track-lyrics"
      tabIndex={-1}
      data-testid="lyrics-publication"
    >
      <div className="section-title">
        <h2>歌词发布预览</h2>
        <Badge>
          {preview?.alignmentConfirmed ? "用户已确认匹配" : "歌词与音频待核对"}
        </Badge>
      </div>
      <HelpNote label="歌词整理规则">
        原稿和提示词分别保存。发布去掉已知结构 /
        人声提示标签，保留演唱文字、重复副歌与未知括号。没有同步时间戳。
      </HelpNote>
      <button
        disabled={busy}
        onClick={() =>
          act(async () => {
            await importAsset("lyrics", workId);
          })
        }
      >
        导入歌词 TXT
      </button>
      {preview ? (
        <>
          <Badge>{sources[preview.source.kind] || "来源待核实"}</Badge>
          <details>
            <summary>歌词来源与版本</summary>
            来源：{sources[preview.source.kind] || preview.source.kind} · 版本{" "}
            {preview.versionId?.slice(0, 8) || "未保存"}
            {preview.source.provider && " · " + preview.source.provider}
            {preview.source.version && " / " + preview.source.version}
          </details>
          <div className="compare lyric-compare">
            <label>
              保留的歌词原稿
              <textarea
                aria-label="发布歌词原稿"
                rows={10}
                readOnly
                value={preview.raw}
              />
            </label>
            <label>
              发布用纯文本
              <textarea
                aria-label="发布纯文本歌词"
                rows={10}
                readOnly
                value={preview.cleaned}
              />
            </label>
          </div>
          {preview.removed.length>0&&<Badge>已整理 {preview.removed.length} 行提示</Badge>}
          {preview.warnings.length>0&&<p className="notice">{preview.warnings.join("；")}</p>}
          {!preview.cleaned.trim() && (
            <p className="notice">缺少歌词</p>
          )}
          {!preview.audioHash && (
            <p className="notice">缺少音频 · 无法确认匹配</p>
          )}
          <label className="inline-check">
            <input
              type="checkbox"
              checked={checked}
              disabled={!preview.audioHash || !preview.cleaned.trim()}
              onChange={(e) => setChecked(e.target.checked)}
            />
            已试听选定音频，确认当前纯文本歌词逐行匹配
          </label>
          <button
            disabled={
              busy || !checked || !preview.versionId || !preview.audioHash
            }
            onClick={() =>
              act(async () => {
                const current = await call("lyrics.preview", { workId });
                if (
                  current.versionId !== preview.versionId ||
                  current.plainHash !== preview.plainHash ||
                  current.audioHash !== preview.audioHash
                )
                  throw Error("歌词或音频已变化，请重新预览确认");
                await call("lyrics.confirm", {
                  workId,
                  versionId: preview.versionId,
                  plainHash: preview.plainHash,
                  audioHash: preview.audioHash,
                  confirmed: true,
                });
                setChecked(false);
              })
            }
          >
            保存本次匹配确认
          </button>
          <details>
            <summary>歌词版本与来源记录（{preview.versions.length}）</summary>
            {preview.versions.map((v: any) => (
              <p key={v.id}>
                {v.id.slice(0, 8)} · {sources[v.source.kind] || v.source.kind} ·{" "}
                {v.createdAt}
              </p>
            ))}
          </details>
        </>
      ) : (
        <p>正在读取歌词…</p>
      )}
    </section>
  );
}
