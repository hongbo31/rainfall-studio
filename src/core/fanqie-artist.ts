import { coverResolutionSchema } from "../shared/cover-handoff";
import {
  FanqieArtistCreationSchema, fanqieArtistAvatarDefaultEdge, fanqieArtistAvatarVoice,
  type FanqieArtistCreationScope, type FanqieArtistSinger,
} from "../shared/fanqie-artist";
import { artistProfileSchema, secondSingerSchema } from "../shared/local-artist";
import { resolveImageSelection } from "./platform-image";
import type { Studio } from "./studio";

export function resolveFanqieArtistCreation(studio: Pick<Studio, "repo" | "mode">, input: unknown): FanqieArtistCreationScope {
  if (studio.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  const { accountId, artistId, expectedRevision, avatarImage } = FanqieArtistCreationSchema.parse(input);
  const account = studio.repo.maybe("accounts", accountId);
  if (!account) throw Error("ACCOUNT_NOT_FOUND");
  if (account.provider !== "fanqie") throw Error("ACCOUNT_PROVIDER_MISMATCH");
  const artist = studio.repo.maybe("accountLocalArtists", artistId);
  if (!artist || artist.accountId !== accountId) throw Error("ARTIST_ACCOUNT_MISMATCH");
  if (artist.revision !== expectedRevision) throw Error("REVISION_CONFLICT");
  const primary = artistProfileSchema.shape.singer.safeParse(artist.profile?.singer);
  const secondary = secondSingerSchema.nullish().safeParse(artist.secondSinger);
  if (!primary.success || !secondary.success) throw Error("FANQIE_ARTIST_NAME_REQUIRED");
  const singers: FanqieArtistSinger[] = [{ version: "A", name: primary.data }];
  if (secondary.data) singers.push({ version: "B", name: secondary.data.name });
  const resolution = coverResolutionSchema.safeParse(artist.defaults?.coverResolution ?? fanqieArtistAvatarDefaultEdge);
  if (!resolution.success) throw Error("FANQIE_ARTIST_AVATAR_RESOLUTION");
  const avatarVoice = fanqieArtistAvatarVoice(artist);
  if (!avatarVoice) throw Error("FANQIE_ARTIST_AVATAR_VOICE_REQUIRED");
  const avatarProfile = resolveImageSelection(studio.repo, avatarImage);
  return { singers, coverResolution: resolution.data, avatarVoice, avatarProfile };
}
