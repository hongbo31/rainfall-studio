import { z } from "zod";
import { PlatformAccountIdSchema } from "./platform-accounts";
import { imageSelectionSchema, type ImageSelection } from "./platform-image";

export const FanqieArtistCreationSchema = PlatformAccountIdSchema.extend({
  artistId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  confirmed: z.literal(true),
  avatarImage: imageSelectionSchema,
});
export const fanqieArtistAvatarMinEdge = 1024;
export const fanqieArtistAvatarDefaultEdge = 1440;
export const fanqieArtistAvatarMaxBytes = 5 * 1024 * 1024;

type AvatarVoice = "male" | "female";

export function fanqieArtistAvatarVoice(artist: { profile?: { gender?: string }; defaults?: { voice?: string } }): AvatarVoice | undefined {
  const voice = artist.profile?.gender ?? artist.defaults?.voice;
  return voice === "male" || voice === "female" ? voice : undefined;
}

export type FanqieArtistSinger = { version: "A" | "B"; name: string };
export type FanqieArtistCreationScope = {
  singers: FanqieArtistSinger[];
  coverResolution: number;
  avatarVoice: AvatarVoice;
  avatarProfile: Pick<ImageSelection, "profileId" | "expectedRevision" | "modelId">;
};
export type FanqieArtistCreationResult = {
  artists: (FanqieArtistSinger & { status: "existing" | "created" })[];
};
