import type { Repository } from "../database";
import { hashValue } from "../quality/scoring";
export function preferenceSnapshot(
  repo: Repository,
  artistId: string,
  seriesId: string | null,
  excluded: string[] = [],
) {
  const checkpoint = seriesId
    ? repo.maybe("seriesCheckpoints", seriesId)
    : undefined;
  if (checkpoint && checkpoint.artistId !== artistId)
    throw Error("ARTIST_SCOPE");
  const refs = repo
    .all("selectionEvents")
    .filter(
      (e) =>
        e.artistId === artistId &&
        (!seriesId || e.seriesId === seriesId) &&
        !excluded.includes(e.workId),
    )
    .slice(-5)
    .map((e) => {
      const w = repo.get("works", e.workId);
      if (w.artistId !== artistId) throw Error("ARTIST_SCOPE");
      return {
        workId: w.id,
        revision: w.revision,
        reason: "explicitly_selected",
        title: w.title ?? "",
        storySummary: String(w.story ?? "").slice(0, 600),
      };
    });
  const value = {
    artistId,
    seriesId,
    seriesBaseRevision: checkpoint?.revision ?? 0,
    confirmedStory: String(checkpoint?.confirmedStory ?? "").slice(0, 4000),
    selected: refs,
    excludedWorkIds: excluded,
    policyVersion: "selected-scope-v1",
    maximumCharacters: 7000,
  };
  return { ...value, hash: hashValue(value) };
}
