import type { Repository, Row } from "./database";
import {
  platformTargets,
  PlatformConfigurationInputSchema,
  type PlatformConfiguration,
  type PlatformConfigurationInput,
  type PlatformTarget,
} from "../shared/platform-config";
import { z } from "zod";

export const simpleSettingsPrefix = "simple-publishing:";
const marker = simpleSettingsPrefix + "migration:v1";
const key = (target: PlatformTarget) =>
  simpleSettingsPrefix + "platform:v1:" + target;
export function accountSupportsTarget(account: Row, target: PlatformTarget) {
  return (
    account.provider === target ||
    (account.provider === "tme" && (target === "qqmusic" || target === "kugou"))
  );
}
export function emptyPlatformConfiguration(
  target: PlatformTarget,
): PlatformConfiguration {
  return {
    version: 1,
    target,
    revision: 1,
    accountId: null,
    artistId: null,
    lyricist: "",
    composer: "",
    album: "",
    language: "",
    genre: "",
    aiDisclosure: "unknown",
    isCover: null,
  };
}
/** Settings-only first-use migration: no legacy row or authorization is rewritten. */
export function initializePlatformConfigurations(repo: Repository) {
  repo.transaction(() => {
    if (repo.maybe("settings", marker)) return;
    const validId = z.uuid();
    const artists = repo
        .all("artists")
        .filter((a) => validId.safeParse(a.id).success),
      accounts = repo
        .all("accounts")
        .filter((a) => validId.safeParse(a.id).success),
      bindings = repo.all("bindings");
    for (const target of platformTargets) {
      if (repo.maybe("settings", key(target))) continue;
      const matches = accounts.filter((a) => accountSupportsTarget(a, target));
      const account = matches.length === 1 ? matches[0] : null;
      const eligible = account
        ? bindings.filter(
            (b) =>
              b.accountId === account.id &&
              b.status !== "revoked" &&
              Array.isArray(b.targets) &&
              b.targets.includes(target) &&
              artists.some((a) => a.id === b.artistId),
          )
        : [];
      const artistIds = [...new Set(eligible.map((b) => b.artistId))];
      const artistId =
        artistIds.length === 1
          ? artistIds[0]
          : artistIds.length === 0 && artists.length === 1
            ? artists[0].id
            : null;
      repo.save("settings", {
        id: key(target),
        value: {
          ...emptyPlatformConfiguration(target),
          accountId: account?.id ?? null,
          artistId,
        },
      });
    }
    repo.save("settings", { id: marker, version: 1 });
  });
}
export function listPlatformConfigurations(
  repo: Repository,
): PlatformConfiguration[] {
  return platformTargets.map(
    (target) =>
      repo.maybe("settings", key(target))?.value ??
      emptyPlatformConfiguration(target),
  );
}
export function assertAccountReference(
  repo: Repository,
  accountId: string,
  target: PlatformTarget,
) {
  const account = repo.maybe("accounts", accountId);
  if (!account) throw Error("ACCOUNT_NOT_FOUND");
  if (!accountSupportsTarget(account, target))
    throw Error("TARGET_ACCOUNT_MISMATCH");
  return account;
}
export function savePlatformConfiguration(
  repo: Repository,
  raw: PlatformConfigurationInput,
  expectedRevision: number,
): PlatformConfiguration {
  const config = PlatformConfigurationInputSchema.parse(raw);
  return repo.transaction(() => {
    const old = repo.maybe("settings", key(config.target))?.value;
    if ((old?.revision ?? 0) !== expectedRevision)
      throw Error("REVISION_CONFLICT");
    if (config.accountId)
      assertAccountReference(repo, config.accountId, config.target);
    if (config.artistId && !repo.maybe("artists", config.artistId))
      throw Error("ARTIST_NOT_FOUND");
    const value: PlatformConfiguration = {
      ...config,
      version: 1,
      revision: (old?.revision ?? 0) + 1,
    };
    repo.save("settings", { id: key(config.target), value });
    return value;
  });
}

export function setPlatformDefaultAccount(
  repo: Repository,
  target: PlatformTarget,
  accountId: string | null,
  expectedRevision: number,
): PlatformConfiguration {
  const { version, revision, ...config } =
    repo.maybe("settings", key(target))?.value ?? emptyPlatformConfiguration(target);
  return savePlatformConfiguration(repo, { ...config, accountId }, expectedRevision);
}
