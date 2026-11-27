import {
  apiProfileSchema,
  saveApiProfileSchema,
  type ApiProfile,
  type SaveApiProfileInput,
} from "../shared/api-profiles";
import type { Repository } from "./database";

const key = (id: string) => "api-profile:" + id;
export function listApiProfiles(repo: Repository): ApiProfile[] {
  return repo
    .settingsByPrefix("api-profile:")
    .map((row) => apiProfileSchema.parse({ ...row, id: row.id.slice(12) }));
}
export function saveApiProfile(
  repo: Repository,
  input: SaveApiProfileInput,
): ApiProfile {
  const { profile, expectedRevision } = saveApiProfileSchema.parse(input);
  return repo.transaction(() => {
    const old = repo.maybe("settings", key(profile.id));
    if ((old?.revision ?? null) !== expectedRevision)
      throw Error("REVISION_CONFLICT");
    if (
      old &&
      (old.providerId !== profile.providerId || old.kind !== profile.kind)
    )
      throw Error("IDENTITY_IMMUTABLE");
    const result = apiProfileSchema.parse({
      ...profile,
      revision: (old?.revision ?? 0) + 1,
    });
    repo.save("settings", { ...result, id: key(profile.id) });
    repo.audit("apiProfile.save", result.id);
    return result;
  });
}
