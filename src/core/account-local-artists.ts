import { randomUUID } from "node:crypto";
import {
  artistNameFromSinger, artistNameLimit, artistProfileSchema, baseArtistDefaults,
  secondSingerSchema, type ArtistMusicType, type ArtistProfile, type ArtistSongAttribute, type SecondSinger,
} from "../shared/local-artist";
import type { ArtistDefaults } from "../shared/schemas";
import type { Repository, Row } from "./database";

const importMarker = "account-local-artists:imported-v1";

export function listAccountLocalArtists(repo: Repository, accountId?: string) {
  if (!repo.maybe("settings", importMarker)?.readyForWorks) {
    repo.transaction(() => {
      const marker = repo.maybe("settings", importMarker);
      if (marker?.readyForWorks) return;
      // The oldest account forms saved directly into the artist library.
      for (const artist of marker ? [] : repo.all("artists").filter(row => !row.accountLocalArtist)) {
        const profile = artistProfileSchema.safeParse(artist.profile);
        if (!profile.success) continue;
        repo.save("accountLocalArtists", {
          id: randomUUID(),
          revision: 1,
          name: artist.name,
          defaults: { ...baseArtistDefaults, ...artist.defaults },
          profile: profile.data,
          promptTemplateId: artist.promptTemplateId && repo.maybe("promptTemplates", artist.promptTemplateId)
            ? artist.promptTemplateId : null,
        });
      }
      for (const artist of repo.all("accountLocalArtists")) saveArtistReference(repo, artist);
      repo.save("settings", { id: importMarker, complete: true, readyForWorks: true });
    });
  }
  const roster = repo.all("accountLocalArtists");
  return accountId ? roster.filter(artist => artist.accountId === accountId) : roster;
}

function saveArtistReference(repo: Repository, artist: Row) {
  const previous = repo.maybe("artists", artist.id);
  if (previous && !previous.accountLocalArtist) throw Error("ARTIST_ID_CONFLICT");
  // Works and frozen publication records refer to this ID even after the musician is removed from the roster.
  repo.save("artists", { ...artist, accountLocalArtist: true });
}

type SaveLocalArtist = {
  id?: string;
  expected?: number;
  accountId?: string;
  defaults: ArtistDefaults;
  musicType?: ArtistMusicType;
  songAttribute?: ArtistSongAttribute;
  originalSinger?: string | null;
  originalWorkId?: string | null;
  isAiWork?: boolean;
  hasCopyrightProof?: boolean;
  profile: ArtistProfile;
  secondSinger?: SecondSinger | null;
  promptTemplateId: string | null;
};

function saveArtist(repo: Repository, artist: Row) {
  const saved = repo.save("accountLocalArtists", artist);
  saveArtistReference(repo, saved);
  return saved;
}

export function saveAccountLocalArtist(repo: Repository, input: SaveLocalArtist) {
  const { id, expected, accountId, defaults, musicType, songAttribute, originalSinger, originalWorkId,
    isAiWork, hasCopyrightProof, profile, promptTemplateId } = input;
  return repo.transaction(() => {
    const previous = id ? repo.get("accountLocalArtists", id) : undefined;
    if (previous?.revision !== expected) throw Error("REVISION_CONFLICT");
    if (accountId) {
      if (previous?.accountId && previous.accountId !== accountId) throw Error("ARTIST_ACCOUNT_MISMATCH");
      repo.get("accounts", accountId);
    }
    if (promptTemplateId && !repo.maybe("promptTemplates", promptTemplateId)) throw Error("ARTIST_PROMPT_NOT_FOUND");
    const singerChanged = !previous || previous.profile.singer !== profile.singer;
    const { secondSinger: oldSinger, ...current } = previous ?? {};
    const secondSinger = secondSingerSchema.nullish().parse(input.secondSinger === undefined ? oldSinger : input.secondSinger);
    return saveArtist(repo, {
      ...current,
      id: id ?? randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      name: singerChanged ? artistNameFromSinger(profile.singer) : previous.name,
      ...(accountId ? { accountId } : {}),
      defaults,
      ...(musicType ? { musicType } : {}),
      ...(songAttribute ? { songAttribute } : {}),
      ...(originalSinger === undefined ? {} : { originalSinger }),
      ...(originalWorkId === undefined ? {} : { originalWorkId }),
      ...(isAiWork === undefined ? {} : { isAiWork }),
      ...(hasCopyrightProof === undefined ? {} : { hasCopyrightProof }),
      profile,
      ...(secondSinger ? { secondSinger } : {}),
      promptTemplateId,
    });
  });
}

type ScopedArtist = { id: string; expected: number; accountId: string };

export function assignAccountLocalArtist(repo: Repository, { id, expected, accountId }: ScopedArtist) {
  return repo.transaction(() => {
    repo.get("accounts", accountId);
    const artist = repo.get("accountLocalArtists", id);
    if (artist.accountId === accountId) return artist;
    if (artist.accountId) throw Error("ARTIST_ACCOUNT_MISMATCH");
    if (artist.revision !== expected) throw Error("REVISION_CONFLICT");
    return saveArtist(repo, { ...artist, accountId, revision: expected + 1 });
  });
}

export function detachAccountLocalArtists(repo: Repository, accountId: string) {
  for (const { accountId: linkedAccount, ...artist } of repo.all("accountLocalArtists")) {
    if (linkedAccount === accountId) saveArtist(repo, { ...artist, revision: artist.revision + 1 });
  }
}

function copyName(artist: Row, roster: Row[]) {
  const names = new Set(roster.map(row => row.name));
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? "（副本）" : `（副本 ${index}）`;
    const name = artistNameFromSinger(artist.name, artistNameLimit - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}

export function copyAccountLocalArtist(repo: Repository, { id, expected, accountId, requestId }: ScopedArtist & { requestId: string }) {
  return repo.transaction(() => {
    const replay = repo.maybe("artists", requestId);
    if (replay) {
      if (replay.copiedFrom !== id || replay.copiedFromRevision !== expected || replay.accountId !== accountId)
        throw Error("IDEMPOTENCY_CONFLICT");
      return repo.get("accountLocalArtists", requestId);
    }
    const source = repo.get("accountLocalArtists", id);
    if (source.accountId !== accountId) throw Error("ARTIST_ACCOUNT_MISMATCH");
    if (source.revision !== expected) throw Error("REVISION_CONFLICT");
    repo.get("accounts", accountId);
    const name = copyName(source, listAccountLocalArtists(repo, accountId));
    const secondSinger = secondSingerSchema.nullish().parse(source.secondSinger);
    return saveArtist(repo, {
      id: requestId, revision: 1, accountId, name, copiedFrom: id, copiedFromRevision: expected,
      defaults: source.defaults, profile: source.profile, promptTemplateId: source.promptTemplateId,
      ...(source.musicType ? { musicType: source.musicType } : {}),
      ...(source.songAttribute ? { songAttribute: source.songAttribute } : {}),
      ...(source.originalSinger ? { originalSinger: source.originalSinger } : {}),
      ...(source.originalWorkId ? { originalWorkId: source.originalWorkId } : {}),
      ...(typeof source.isAiWork === "boolean" ? { isAiWork: source.isAiWork } : {}),
      ...(typeof source.hasCopyrightProof === "boolean" ? { hasCopyrightProof: source.hasCopyrightProof } : {}),
      ...(secondSinger ? { secondSinger } : {}),
    });
  });
}

export function deleteAccountLocalArtist(repo: Repository, id: string, expected: number) {
  return repo.transaction(() => {
    const artist = repo.get("accountLocalArtists", id);
    if (artist.revision !== expected) throw Error("REVISION_CONFLICT");
    if (!repo.maybe("artists", id)) saveArtistReference(repo, artist);
    repo.db.prepare("DELETE FROM accountLocalArtists WHERE id = ?").run(id);
    return { id };
  });
}
