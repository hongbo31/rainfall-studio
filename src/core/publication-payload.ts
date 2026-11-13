import type { Studio } from "./studio";
import type { Row } from "./database";
export function publicationPayload(s: Studio, w: Row) {
  const warnings: string[] = [];
  const asset = (role: string, code: string) => {
    const id = w.assets[role];
    if (!id) {
      warnings.push(code + "_MISSING");
      return null;
    }
    try {
      s.locate(id);
      const a = s.get("assets", id);
      return {
        assetId: id,
        sha256: a.sha256,
        mime: a.mime,
        bytes: a.bytes,
        width: a.metadata?.width,
        height: a.metadata?.height,
      };
    } catch {
      warnings.push(code + "_MISSING_OR_CORRUPT");
      return null;
    }
  };
  const audio = asset(w.selectedAudioVariant==="B"?"audio_B":"audio_A", "AUDIO"),
    cover = asset("cover", "COVER"),
    l = s.lyricService().forWork(w);
  if (w.config?.voice !== "instrumental") {
    if (!l.cleaned.trim()) warnings.push("LYRICS_MISSING");
    if (!l.alignmentConfirmed) warnings.push("LYRICS_AUDIO_MATCH_UNCONFIRMED");
    if (l.warnings.length) warnings.push("LYRICS_BRACKETS_REQUIRE_REVIEW");
  }
  return {
    schemaVersion: 1,
    workId: w.id,
    workRevision: w.revision,
    title: w.title,
    audio,
    cover,
    lyrics: {
      versionId: l.versionId,
      source: l.source,
      raw: l.raw,
      plainText: l.cleaned,
      plainHash: l.plainHash,
      alignmentConfirmed: l.alignmentConfirmed,
      audioHash: l.audioHash,
      synchronization: "none",
    },
    warnings,
  };
}
