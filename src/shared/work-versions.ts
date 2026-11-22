export type WorkVersionSlot = "audio_A" | "audio_B";

export type WorkVersion = {
  title: string;
  alternateTitle?: string | null;
  assets?: Partial<Record<WorkVersionSlot | "cover" | "cover_B", string>>;
};

export function workVersionTitle(work: WorkVersion, slot: WorkVersionSlot) {
  return slot === "audio_B" ? work.alternateTitle?.trim() || work.title : work.title;
}

export function workVersionCover(work: WorkVersion, slot: WorkVersionSlot) {
  const assets = work.assets;
  if (slot === "audio_A") return assets?.cover;
  return assets?.cover_B ?? (assets?.audio_A ? undefined : assets?.cover);
}
