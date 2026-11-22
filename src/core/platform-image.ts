import { randomUUID } from "node:crypto";
import { imageApiModel, supportsImageApiModel } from "../shared/api-profiles";
import { coverResolutionSchema } from "../shared/cover-handoff";
import { accountSupportsTarget } from "../shared/platform-accounts";
import { imageApiProviders, imageCredentialProfiles, platformImageSchemas, type ImageChoice, type PlatformImageScope } from "../shared/platform-image";
import { listApiProfiles, saveApiProfile } from "./api-profiles";
import type { Repository } from "./database";
import { freezeRoute, readGenerationConfig, saveGenerationConfig } from "./generation-config";

export function prepareImageCredentialProfile(repo: Repository, raw: unknown) {
  const { providerId } = platformImageSchemas["platformImage.prepareCredential"].parse(raw);
  return repo.transaction(() => {
    const [existing] = imageCredentialProfiles(listApiProfiles(repo), providerId, readGenerationConfig(repo).roles.image);
    if (existing) return existing;
    const provider = imageApiProviders.find(item => item.id === providerId)!;
    return saveApiProfile(repo, { profile: { id: randomUUID(), kind: "image", providerId,
      label: provider.name, modelId: imageApiModel(providerId), executionEnabled: false }, expectedRevision: null });
  });
}

function requireImageProfile(repo: Repository, selection: ImageChoice & { expectedRevision?: number }) {
  const profile = listApiProfiles(repo).find(item => item.id === selection.profileId);
  if (!profile || profile.kind !== "image" || profile.providerId !== selection.providerId) throw Error("IMAGE_PROFILE_REQUIRED");
  if (selection.expectedRevision !== undefined && profile.revision !== selection.expectedRevision) throw Error("REVISION_CONFLICT");
  if (!supportsImageApiModel(profile.providerId, selection.modelId)) throw Error("IMAGE_MODEL_REQUIRED");
  return profile;
}

export function resolveImageSelection(repo: Repository, selection: ImageChoice & { expectedRevision?: number }) {
  const profile = requireImageProfile(repo, selection);
  return { profileId: profile.id, expectedRevision: profile.revision, modelId: selection.modelId };
}

export function resolveMusicBrowserCoverProfile(repo: Repository, selection?: ImageChoice & { expectedRevision?: number }) {
  if (selection) return resolveImageSelection(repo, selection);
  const image = freezeRoute(repo, "image", { source: "default" });
  return image.capability === "image_api" && image.profileId && image.profileRevision
    ? { profileId: image.profileId, expectedRevision: image.profileRevision } : null;
}

export function setDefaultImageProfile(repo: Repository, raw: unknown) {
  const selection = platformImageSchemas["platformImage.setDefault"].parse(raw);
  return repo.transaction(() => {
    const defaults = readGenerationConfig(repo);
    if (selection.onlyIfUnset && defaults.roles.image) return defaults;
    const { revision, ...profile } = requireImageProfile(repo, selection);
    if (profile.modelId !== selection.modelId)
      saveApiProfile(repo, { profile: { ...profile, modelId: selection.modelId }, expectedRevision: revision });
    if (defaults.roles.image === profile.id) return defaults;
    return saveGenerationConfig(repo, { role: "image", profileId: profile.id, expectedRevision: defaults.revision });
  });
}

export function resolvePlatformImage(repo: Repository, raw: unknown): PlatformImageScope {
  const input = platformImageSchemas["platformImage.generate"].parse(raw);
  requireImageProfile(repo, input);
  const artist = repo.maybe("accountLocalArtists", input.artistId);
  const account = artist?.accountId && repo.maybe("accounts", artist.accountId);
  if (!artist || !account || !accountSupportsTarget(account.provider, input.platform)) throw Error("IMAGE_ARTIST_PLATFORM_MISMATCH");
  const resolution = coverResolutionSchema.safeParse(artist.defaults?.coverResolution);
  if (!resolution.success) throw Error("IMAGE_RESOLUTION_REQUIRED");
  if (resolution.data !== input.resolution) throw Error("IMAGE_RESOLUTION_CHANGED");
  return { artistName: artist.name, resolution: resolution.data };
}
