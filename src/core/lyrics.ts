import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Studio } from "./studio";
import { hash, type Row } from "./database";
import { cleanLyricText } from "../shared/tme-lyrics";
export type LyricOrigin = {
  kind: "manual" | "generation_input" | "provider_actual" | "legacy_unknown";
  provider?: string;
  providerOutputId?: string;
  version?: string | null;
  audioAssetId?: string;
  fileName?: string;
  purpose?: "publication_edit";
};
export function candidateLyricOrigin(candidate: Row, draft: Row) {
  const actual = candidate.actualLyrics;
  return actual
    ? {
        text: actual.text,
        origin: {
          kind: "provider_actual",
          provider: candidate.provider,
          providerOutputId: candidate.providerOutputId,
          version: actual.version ?? null,
          audioAssetId: candidate.assetId,
        } as LyricOrigin,
      }
    : {
        text: candidate.submittedLyrics?.text ?? draft.pair.lyrics,
        origin: {
          kind: "generation_input",
          provider: candidate.provider,
          providerOutputId: candidate.providerOutputId,
          audioAssetId: candidate.assetId,
        } as LyricOrigin,
      };
}
export class LyricService {
  constructor(private s: Studio) {}
  publicationVersion(work: Row, text: string) {
    const parentId = this.forWork(work).versionId;
    const existing = this.s
      .all("settings")
      .find(
        (r) =>
          r.kind === "lyrics-version" &&
          r.version.workId === work.id &&
          r.version.parentId === parentId &&
          r.version.source.purpose === "publication_edit" &&
          r.version.raw === text,
      );
    if (existing) return existing.version;
    const version = {
      id: randomUUID(),
      workId: work.id,
      raw: text,
      rawHash: hash(text),
      plainHash: hash(text),
      source: { kind: "manual", purpose: "publication_edit" },
      parentId,
      createdAt: this.s.now().toISOString(),
    };
    this.s.save("settings", {
      id: "lyrics-version:" + version.id,
      kind: "lyrics-version",
      version,
    });
    return version;
  }
  record(work: Row, source: LyricOrigin = { kind: "manual" }) {
    const raw = work.lyrics ?? "",
      clean = cleanLyricText(raw),
      id = randomUUID();
    const version = {
      id,
      workId: work.id,
      raw,
      rawHash: hash(raw),
      plainHash: hash(clean.cleaned),
      source,
      parentId: work.lyricsVersionId ?? null,
      createdAt: this.s.now().toISOString(),
    };
    this.s.save("settings", {
      id: "lyrics-version:" + id,
      kind: "lyrics-version",
      version,
    });
    work.lyricsVersionId = id;
    work.lyricsConfirmation = null;
    return version;
  }
  forWork(work: Row) {
    const version = this.s.repo.maybe(
      "settings",
      "lyrics-version:" + work.lyricsVersionId,
    )?.version;
    const raw = work.lyrics ?? "",
      clean = cleanLyricText(raw),
      plainHash = hash(clean.cleaned);
    const valid =
        version && version.workId === work.id && version.rawHash === hash(raw),
      versionId = valid ? version.id : null,
      source = valid ? version.source : { kind: "legacy_unknown" };
    let audioHash: string | null = null;
    try {
      const selected=work.assets[work.selectedAudioVariant==="B"?"audio_B":"audio_A"];
      if (selected) {
        this.s.locate(selected);
        audioHash = this.s.get("assets", selected).sha256;
      }
    } catch {}
    const c = work.lyricsConfirmation,
      alignmentConfirmed = !!(
        clean.cleaned.trim() &&
        audioHash &&
        versionId &&
        c?.versionId === versionId &&
        c.audioHash === audioHash &&
        c.plainHash === plainHash
      );
    return {
      ...clean,
      versionId,
      plainHash,
      source,
      audioHash,
      alignmentConfirmed,
      versions: this.s
        .all("settings")
        .filter(
          (r) => r.kind === "lyrics-version" && r.version.workId === work.id,
        )
        .map((r) => r.version),
    };
  }
  preview(workId: string) {
    const w = this.s.get("works", workId);
    if (!w.lyricsVersionId)
      this.s.repo.transaction(() => {
        this.record(w, { kind: "legacy_unknown" });
        this.s.save("works", w);
      });
    return this.forWork(w);
  }
  confirm(input: {
    workId: string;
    versionId: string;
    plainHash: string;
    audioHash: string;
    confirmed: true;
  }) {
    return this.s.repo.transaction(() => {
      const w = this.s.get("works", input.workId),
        p = this.forWork(w);
      if (
        !p.cleaned.trim() ||
        !p.audioHash ||
        input.versionId !== p.versionId ||
        input.plainHash !== p.plainHash ||
        input.audioHash !== p.audioHash
      )
        throw Error("LYRICS_CONFIRMATION_STALE");
      const lyricsConfirmation = {
        versionId: p.versionId,
        plainHash: p.plainHash,
        audioHash: p.audioHash,
        confirmedAt: this.s.now().toISOString(),
      };
      this.s.save("works", {
        ...w,
        revision: w.revision + 1,
        lyricsConfirmation,
      });
      return this.forWork(this.s.get("works", w.id));
    });
  }
  async importText(source: string, workId: string) {
    if (
      !path.isAbsolute(source) ||
      source.startsWith("\\\\") ||
      fs.lstatSync(source).isSymbolicLink() ||
      path.extname(source).toLowerCase() !== ".txt"
    )
      throw Error("LYRICS_SOURCE_REJECTED");
    if (fs.statSync(source).size > 400000) throw Error("LYRICS_SIZE_LIMIT");
    const lyrics = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(fs.readFileSync(source));
    if (lyrics.length > 100000) throw Error("LYRICS_SIZE_LIMIT");
    const w = this.s.get("works", workId);
    this.s.saveWork(
      { ...w, expected: w.revision, lyrics },
      { kind: "manual", fileName: path.basename(source) },
    );
    return this.preview(workId);
  }
}
