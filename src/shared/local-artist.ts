import { z } from "zod";

const creditName = z.string().trim().min(1).max(500);
export const artistNameLimit = 100;

export function artistNameFromSinger(singer: string, limit = artistNameLimit) {
  if (singer.length <= limit) return singer;
  return singer.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

const genderSchema = z.enum(["female", "male", "other"]);
const voicePersonaSchema = z.string().trim().max(500);
export const artistWeightRange = { min: 0, max: 100 } as const;
const artistWeightSchema = z.number().min(artistWeightRange.min).max(artistWeightRange.max).optional();
export const artistProfileSchema = z.strictObject({
  lyricist: creditName,
  composer: creditName,
  singer: creditName,
  contractMode: z.enum(["exclusive", "non_exclusive"]),
  gender: genderSchema.optional(),
  voicePersona: voicePersonaSchema.optional(),
  timbreWeight: artistWeightSchema,
  styleWeight: artistWeightSchema,
});

export type ArtistProfile = z.infer<typeof artistProfileSchema>;
export const artistMusicTypeSchema = z.enum(["original", "cover"]);
export type ArtistMusicType = z.infer<typeof artistMusicTypeSchema>;
export const artistSongAttributeSchema = z.enum(["original", "multi_version"]);
export type ArtistSongAttribute = z.infer<typeof artistSongAttributeSchema>;

// Frozen plan snapshots may contain the fields saved by older versions.
export const storedSecondSingerSchema = z.strictObject({
  name: creditName,
  gender: genderSchema.optional(),
  voicePersona: voicePersonaSchema.optional(),
});
export const secondSingerSchema = storedSecondSingerSchema.transform(({ name }) => ({ name }));
export type SecondSinger = z.infer<typeof secondSingerSchema>;

const recordingSingersSchema = z.strictObject({ A: creditName, B: creditName });
type ArtistSingerSource = {
  name?: string;
  accountLocalArtist?: boolean;
  profile?: Pick<ArtistProfile, "singer">;
  secondSinger?: SecondSinger;
};

export function artistRecordingSingers(artist: ArtistSingerSource) {
  if (!artist.accountLocalArtist || !artist.profile?.singer) return;
  const primary = artist.profile.singer;
  return { A: primary, B: artist.secondSinger?.name ?? primary };
}

export function workRecordingSinger(
  work: { artistId?: string; selectedAudioVariant?: "A" | "B"; artistSnapshot?: { id: string; defaults?: Record<string, unknown> } },
  artist?: ArtistSingerSource | null,
  version: "A" | "B" = work.selectedAudioVariant === "B" ? "B" : "A",
) {
  const snapshot = work.artistSnapshot;
  if (snapshot && snapshot.id === work.artistId) {
    const saved = recordingSingersSchema.safeParse(snapshot.defaults?.recordingSingers);
    if (saved.success) return saved.data[version];
  }
  return (artist ? artistRecordingSingers(artist)?.[version] : undefined) ?? artist?.name;
}

export const songTypeSchema = z.enum(["vocal", "instrumental"]);
export type SongType = z.infer<typeof songTypeSchema>;
export function artistSongType(defaults?: { voice?: string } | null): SongType {
  return defaults?.voice === "instrumental" ? "instrumental" : "vocal";
}

export const baseArtistDefaults = {
  genre: "流行 / 民谣",
  voice: "female" as const,
  lyricTone: "克制、细腻的叙事",
  bpmMin: 72,
  bpmMax: 96,
  coverStyle: "雨夜、暖紫色、电影感留白",
  language: "中文",
  mood: "温柔",
  duration: 180,
};
