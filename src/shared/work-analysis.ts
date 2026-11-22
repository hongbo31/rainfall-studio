import { z } from "zod";
import { workVersionTitle, type WorkVersion } from "./work-versions";

const versions = ["A", "B"] as const;
const extensionSchema = z.enum(["wav", "mp3", "flac", "ogg", "m4a"]);
type AudioVersion = (typeof versions)[number];

export const WorkAudioShareSchema = z.strictObject({
  workId: z.uuid(),
  version: z.enum(versions),
  assetId: z.uuid(),
});

export type WorkForAnalysis = WorkVersion & {
  id: string;
  lyrics?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  config?: { genre?: string; voice?: string; bpmMin?: number; bpmMax?: number };
  audioVersions?: { assetId: string; actualLyrics?: { text?: string } | null }[];
};

type RecordingAsset = {
  id: string;
  kind: string;
  ext: string;
  metadata?: { duration?: unknown };
};

export type ShareRecording = {
  version: AudioVersion;
  assetId: string;
  extension: z.infer<typeof extensionSchema>;
  filename: string;
  durationSeconds?: number;
};

export function safeWorkFilenameStem(title: string) {
  const cleaned = title.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").trim();
  const stem = Array.from(cleaned).slice(0, 72).join("").replace(/[. ]+$/u, "") || "作品";
  return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(stem) ? "_" + stem : stem;
}

export function describeShareRecording(
  work: WorkVersion,
  version: AudioVersion,
  asset?: RecordingAsset,
): ShareRecording | undefined {
  if (!asset || asset.id !== work.assets?.[`audio_${version}`] || asset.kind !== "audio") return;
  const extension = extensionSchema.safeParse(asset.ext);
  if (!extension.success) return;
  const filenameStem = safeWorkFilenameStem(workVersionTitle(work, `audio_${version}`));
  const duration = Number(asset.metadata?.duration);
  return {
    version,
    assetId: asset.id,
    extension: extension.data,
    filename: `${filenameStem}.${extension.data}`,
    ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
  };
}

export function shareableRecordings(work: WorkForAnalysis, assets: RecordingAsset[]) {
  return versions.flatMap(version => {
    const asset = assets.find(item => item.id === work.assets?.[`audio_${version}`]);
    const recording = describeShareRecording(work, version, asset);
    return recording ? [recording] : [];
  });
}

const providers: Record<string, string> = { yourmusic: "谱乐 AI", pule: "谱乐 AI", suno: "Suno" };
const voices: Record<string, string> = { female: "女声", male: "男声", duet: "对唱", instrumental: "纯音乐" };

export function workAnalysisText(work: WorkForAnalysis, recordings: ShareRecording[]) {
  const { genre, voice, bpmMin, bpmMax } = work.config ?? {};
  const generation = [
    providers[work.provider ?? ""],
    work.model ? `模型 ${work.model}` : "",
    genre ? `曲风 ${genre}` : "",
    voices[voice ?? ""],
    Number.isFinite(bpmMin) && Number.isFinite(bpmMax) ? `BPM 参考 ${bpmMin}–${bpmMax}` : "",
  ].filter(Boolean);
  const lyrics = work.lyrics?.trim();
  const style = work.prompt?.trim();
  const title = recordings.length === 1 ? workVersionTitle(work, `audio_${recordings[0].version}`) : work.title;
  const versionsWithLyrics = recordings.flatMap(({ version, assetId }) => {
    const text = work.audioVersions?.find(item => item.assetId === assetId)?.actualLyrics?.text?.trim();
    return text && text !== lyrics ? [`## ${version} 版回传歌词\n${text}`] : [];
  });
  return [
    "请试听我这次附上的原始音频，分析为什么听起来忽高忽低、不好听。",
    "请分开判断音量或响度起伏、音高跳跃或音域变化，以及换声、唱法、编曲和混音的影响。按版本标出具体时间点，区分可从音频确认的现象和可能原因。",
    "结合歌词与风格提示词，给出最优先的修改项和一份可直接用于重新生成的风格提示词。若附了 A、B 两版，请比较哪一版更自然稳定。音频读不到时请明确说明。",
    `# ${title}`,
    "## 可供对照的录音\n" + recordings.map(({ filename, durationSeconds }) =>
      `- ${filename}${durationSeconds ? `（约 ${Math.round(durationSeconds)} 秒）` : ""}`,
    ).join("\n"),
    ...(generation.length ? [`## 已保存的创作设置\n${generation.join(" · ")}`] : []),
    ...(style ? [`## 已保存的风格提示词\n${style}`] : []),
    ...(lyrics ? [`## 已保存的歌词\n${lyrics}`] : []),
    ...versionsWithLyrics,
  ].join("\n\n");
}
