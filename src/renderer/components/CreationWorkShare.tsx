import React, { useRef, useState } from "react";
import {
  shareableRecordings, workAnalysisText, type ShareRecording, type WorkForAnalysis,
} from "../../shared/work-analysis";
import { downloadArchiveErrors } from "../../shared/download-archive";
import type { WorkVersionSlot } from "../../shared/work-versions";
import { useStudio } from "../context";
import HelpHint from "./HelpHint";

const exportErrors: Record<string, string> = {
  NOT_FOUND: "作品或音频已变更，请重新打开作品后再试。",
  SHARE_AUDIO_CHANGED: "此版本的音频已变更，请重新下载。",
  SHARE_AUDIO_UNAVAILABLE: "此版本的音频暂不可用。",
  ASSET_MISSING_OR_CORRUPT: "音频丢失或损坏，请重新导入。",
  SHARE_DESTINATION_IN_LIBRARY: "请选择作品库以外的保存位置。",
  WORKSPACE_CHANGED: "工作区已变化，请重新选择作品。",
};

export default function CreationWorkShare({ work, slot }: { work: WorkForAnalysis; slot?: WorkVersionSlot }) {
  const { data, notify } = useStudio();
  const recordings = shareableRecordings(work, data.assets ?? []).filter(recording => !slot || `audio_${recording.version}` === slot);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyFallback, setCopyFallback] = useState("");

  const download = async (recording: ShareRecording) => {
    setError("");
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const result = await window.rainfall.exportFile("workAudio", {
        workId: work.id, version: recording.version, assetId: recording.assetId,
      });
      if (!result.ok) {
        setError(downloadArchiveErrors[result.error.code] ?? exportErrors[result.error.code] ?? "音频保存失败，请检查文件和保存位置。");
      } else if (result.value !== null) {
        notify(`已保存 ${recording.version} 版原始音频`);
      }
    } catch {
      setError("音频保存失败，请重试。");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const copy = async () => {
    const text = workAnalysisText(work, recordings);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFallback("");
      notify("已复制分析资料");
    } catch {
      setCopyFallback(text);
    }
  };

  return (
    <details className="creation-share">
      <summary>分享给 AI</summary>
      <div className="creation-share-content">
        {recordings.length ? (
          <div className="button-row">
            {recordings.map(recording => (
              <button type="button" key={recording.version} disabled={busy} onClick={() => void download(recording)}>
                下载 {recording.version} 版
              </button>
            ))}
            <button type="button" onClick={() => void copy()}>复制分析资料</button>
            <HelpHint label="分享说明">把想分析的音频上传给 AI，再粘贴分析资料。</HelpHint>
          </div>
        ) : <p className="muted">暂无可分享音频</p>}
        {error && <p role="alert">{error}</p>}
        {copyFallback && <label>
          分析资料 · 请手动复制
          <textarea readOnly rows={5} value={copyFallback} onFocus={event => event.target.select()} />
        </label>}
      </div>
    </details>
  );
}
