import React from "react";
import { artistSongType } from "../../shared/local-artist";
import { formatCoverResolution } from "./ArtistProfileFields";
import type { LocalArtist } from "./LocalArtistCreator";

const labels: Readonly<Record<string, string>> = {
  singer: "默认歌手",
  lyricist: "默认词作者",
  composer: "默认曲作者",
  contractMode: "签约模式",
  gender: "性别",
  voicePersona: "音色",
  genre: "风格",
  voice: "演唱方式",
  lyricTone: "歌词语气",
  bpmMin: "最低 BPM",
  bpmMax: "最高 BPM",
  coverStyle: "封面风格",
  coverResolution: "封面分辨率",
  instruments: "乐器",
  seriesStory: "系列故事",
  language: "语种",
  mood: "情绪",
  duration: "时长",
};
const values: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  contractMode: { exclusive: "独家签约", non_exclusive: "非独家签约" },
  gender: { female: "女", male: "男", other: "其他" },
  voice: { female: "女声", male: "男声", duet: "对唱", instrumental: "纯音乐" },
};

function artistDetailValue(key: string, value: unknown) {
  if (typeof value === "number") {
    if (key === "coverResolution") return formatCoverResolution(value);
    if (key === "duration") return `${value} 秒`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value !== "string" || !value.trim()) return null;
  const options = Object.hasOwn(values, key) ? values[key] : undefined;
  return options && Object.hasOwn(options, value) ? options[value] : value;
}

export default function LyricInspirationArtist({ artist, templateName }: { artist: LocalArtist; templateName?: string }) {
  const entries = [
    ...Object.entries(artist.profile ?? {}).map(([key, value]) => ({ group: "profile", key, value })),
    ...Object.entries(artist.defaults ?? {}).map(([key, value]) => ({ group: "defaults", key, value })),
  ];
  return (
    <section aria-label="艺人资料">
      <dl className="plan-workflow-fields">
        <div><dt>创作类型</dt><dd>{artistSongType(artist.defaults) === "instrumental" ? "纯音乐" : "带歌词"}</dd></div>
        {templateName && <div><dt>提示词模板</dt><dd>{templateName}</dd></div>}
        {entries.map(({ group, key, value }) => {
          const text = artistDetailValue(key, value);
          if (text === null) return null;
          const label = key === "singer" && artist.secondSinger ? "A 版歌手" : (Object.hasOwn(labels, key) ? labels[key] : key);
          return <div key={`${group}:${key}`}><dt>{label}</dt><dd>{text}</dd></div>;
        })}
        {artist.secondSinger && <div><dt>B 版歌手</dt><dd>{artist.secondSinger.name}</dd></div>}
      </dl>
    </section>
  );
}
