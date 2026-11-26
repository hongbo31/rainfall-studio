import { describeShareRecording, WorkAudioShareSchema } from "../shared/work-analysis";
import { exportManagedAsset } from "./assets";
import type { Studio } from "./studio";

function resolveRecording(s: Studio, raw: unknown) {
  const { workId, version, assetId } = WorkAudioShareSchema.parse(raw);
  const work = s.get("works", workId);
  if (work.assets?.[`audio_${version}`] !== assetId) throw Error("SHARE_AUDIO_CHANGED");
  const asset = s.get("assets", assetId);
  const recording = describeShareRecording(
    { title: work.title, alternateTitle: work.alternateTitle, assets: work.assets },
    version,
    { id: asset.id, kind: asset.kind, ext: asset.ext },
  );
  if (!recording) throw Error("SHARE_AUDIO_UNAVAILABLE");
  return { recording, sha256: asset.sha256 };
}

export function workAudioExportInfo(s: Studio, input: unknown) {
  const { recording } = resolveRecording(s, input);
  return { filename: recording.filename, extension: recording.extension, version: recording.version };
}

export async function exportWorkAudio(s: Studio, input: unknown, destination: string) {
  const { recording, sha256 } = resolveRecording(s, input);
  const target = await exportManagedAsset(s, recording.assetId, sha256, destination);
  return { path: target, notice: `已保存 ${recording.version} 版原始音频` };
}
