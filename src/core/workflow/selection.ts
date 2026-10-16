import { randomUUID } from "node:crypto";
import { Repository, type Row } from "../database";
import { SelectionSchema } from "../../shared/daily";
import { hashValue } from "../quality/scoring";
export function selectCandidate(
  repo: Repository,
  raw: unknown,
  materialize: (draft: Row, candidate: Row) => { id: string },
) {
  const input = SelectionSchema.parse(raw),
    requestHash = hashValue(input);
  return repo.transaction(() => {
    const prior = repo
      .all("selectionEvents")
      .find((e) => e.requestId === input.requestId);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw Error("IDEMPOTENCY_CONFLICT");
      return prior;
    }
    const c = repo.get("candidates", input.candidateId);
    if (c.selectedAt) throw Error("ALREADY_SELECTED");
    if (
      c.state !== "ready" ||
      !c.assetId ||
      repo.get("assets", c.assetId).kind !== "audio"
    )
      throw Error("AUDIO_NOT_READY");
    const d = repo.get("drafts", c.draftId);
    if ((d.seriesId ?? null) !== input.seriesId) throw Error("SERIES_SCOPE");
    let checkpoint: Row | undefined;
    if (input.seriesId) {
      repo.get("series", input.seriesId);
      checkpoint = repo.maybe("seriesCheckpoints", input.seriesId);
      if (checkpoint && checkpoint.artistId !== d.artistId)
        throw Error("ARTIST_SCOPE");
      if (
        (checkpoint?.revision ?? 0) !== input.expectedSeriesRevision ||
        (d.seriesBaseRevision ?? 0) !== input.expectedSeriesRevision
      )
        throw Error("SERIES_REVISION_CONFLICT");
    }
    const work = materialize(d, c),
      at = new Date().toISOString(),
      event = {
        id: randomUUID(),
        ...input,
        requestHash,
        artistId: d.artistId,
        workId: work.id,
        checkpointKey: input.seriesId
          ? input.seriesId + ":" + input.expectedSeriesRevision
          : null,
        appliedAt: at,
      };
    repo.save("selectionEvents", event);
    repo.save("candidates", { ...c, selectedAt: at, selectedWorkId: work.id });
    for (const sibling of repo
      .all("candidates")
      .filter((other) => other.id !== c.id && !other.selectedAt)) {
      const otherDraft = repo.maybe("drafts", sibling.draftId);
      if (
        otherDraft &&
        (otherDraft.id === d.id ||
          (input.seriesId &&
            otherDraft.seriesId === input.seriesId &&
            (otherDraft.seriesBaseRevision ?? 0) ===
              (d.seriesBaseRevision ?? 0)))
      )
        repo.save("candidates", {
          ...sibling,
          selectionDisposition: "superseded",
          resolvedBySelection: event.id,
        });
    }
    if (input.seriesId)
      repo.save("seriesCheckpoints", {
        id: input.seriesId,
        artistId: d.artistId,
        revision: (checkpoint?.revision ?? 0) + 1,
        confirmedStory: [checkpoint?.confirmedStory, d.draft.storyBeat]
          .filter(Boolean)
          .join("\n"),
        selectedWorkRefs: [
          ...(checkpoint?.selectedWorkRefs ?? []),
          { workId: work.id, candidateId: c.id },
        ],
        openThreads: checkpoint?.openThreads ?? [],
      });
    return event;
  });
}
