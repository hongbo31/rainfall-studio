import { randomUUID } from "node:crypto";
import type { Repository } from "../database";
import { parseDraft } from "../../shared/creation";
import { PairSchema } from "../quality/contracts";
import { pairHash } from "../quality/scoring";

const selectionKey = "inbox-music-input";
export function selectedInboxMusicInput(repo: Repository) {
  const selected = repo.maybe("settings", selectionKey);
  return selected ? repo.maybe("drafts", selected.draftId) : null;
}

// Selecting text creates a local input snapshot. It never evaluates or dispatches it.
export function selectInboxMusicInput(repo: Repository, candidateId: string) {
  return repo.transaction(() => {
    const candidate = repo.get("textCandidates", candidateId);
    if (
      !candidate.isCurrent ||
      candidate.lineageState !== "complete" ||
      candidate.localCheck?.status === "failed"
    )
      throw Error("INBOX_INPUT_NOT_READY");
    const original = repo.get("drafts", candidate.draftId);
    if (
      original.source !== "local-inbox" ||
      original.artistId !== candidate.artistId ||
      original.seriesId !== candidate.seriesId
    )
      throw Error("INBOX_INPUT_SCOPE_REJECTED");
    const existing = repo
      .all("drafts")
      .find((d) => d.inputSelection?.candidateId === candidateId);
    if (existing) {
      repo.save("settings", { id: selectionKey, draftId: existing.id });
      return existing;
    }
    const draft = parseDraft(original.draft),
      id = randomUUID(),
      sessionId = randomUUID(),
      turnId = randomUUID();
    const at = new Date().toISOString(),
      provenance = candidate.source.provenance;
    const pair = PairSchema.parse({
      attemptId: turnId,
      revisionId: id,
      parentRevisionId: original.id,
      lyrics: draft.sections
        .map((section) => `[${section.kind}]\n${section.lines.join("\n")}`)
        .join("\n\n"),
      musicPrompt: draft.musicPrompts.yourmusic.positiveStyle,
      intent: draft.storyBeat,
      language: draft.language,
      style: draft.style,
      generator: {
        modelId: provenance.model || "external-unspecified",
        modelVersion: "declared-unverified",
        promptVersion: provenance.promptVersion || "external-unspecified",
      },
      lockedSpans: [],
      capability: {
        version: "unverified-import-v1",
        verified: false,
        lengthUnit: null,
        limits: {},
        requiredFields: draft.instrumental
          ? ["musicPrompt"]
          : ["lyrics", "musicPrompt"],
      },
    });
    const selected = {
      id,
      turnId,
      sessionId,
      artistId: candidate.artistId,
      seriesId: candidate.seriesId,
      seriesBaseRevision: candidate.seriesId
        ? (repo.maybe("seriesCheckpoints", candidate.seriesId)?.revision ?? 0)
        : 0,
      parentDraftId: original.id,
      revision: 0,
      source: "local-inbox",
      draft,
      pair,
      pairHash: pairHash(pair),
      at,
      qualityState: "not_evaluated",
      inputSelection: {
        candidateId,
        sourceDraftId: original.id,
        externalItemId: candidate.externalItemId,
        externalRevision: candidate.externalRevision,
        itemHash: candidate.itemHash,
        channelId: candidate.source.channelId,
        provenance,
        selectedAt: at,
        selection: "manual",
      },
    };
    repo.save("creativeSessions", {
      id: sessionId,
      artistId: candidate.artistId,
      revision: 1,
      activeTurnId: turnId,
      draftId: id,
    });
    repo.save("creativeTurns", {
      id: turnId,
      requestId: randomUUID(),
      sessionId,
      artistId: candidate.artistId,
      seriesId: candidate.seriesId,
      instruction: draft.storyBeat,
      source: "local-inbox",
      state: "manual_input",
      reasons: ["QUALITY_NOT_EVALUATED"],
      revisionCount: 0,
      draftId: id,
      spent: 0,
      createdAt: at,
    });
    repo.save("drafts", selected);
    repo.save("settings", { id: selectionKey, draftId: id });
    repo.audit("inbox.selectMusicInput", candidateId, {
      draftId: id,
      externalRevision: candidate.externalRevision,
    });
    return selected;
  });
}
