type NextItem = {
  key: "audio" | "lyrics" | "cover" | "rights" | "save" | "publish";
  label: string;
};
export function describeWorkReadiness(
  work: any,
  payload: any,
  saveState: string,
) {
  const items: NextItem[] = [];
  if (saveState !== "已保存")
    return {
      state: "unsaved",
      ready: false,
      items,
      next: { key: "save", label: "先保存当前编辑" } as NextItem,
    };
  if (
    !payload ||
    payload.workId !== work.id ||
    payload.workRevision !== work.revision ||
    (payload.audio && payload.audio.assetId !== work.assets.audio_A) ||
    (payload.cover && payload.cover.assetId !== work.assets.cover)
  )
    return { state: "checking", ready: false, items, next: null };
  if (!payload.audio)
    items.push({ key: "audio", label: "导入或重新核验发布音频 A" });
  if (!payload.lyrics.plainText.trim())
    items.push({ key: "lyrics", label: "补充歌词并检查发布预览" });
  else if (
    !payload.lyrics.alignmentConfirmed ||
    payload.warnings.includes("LYRICS_BRACKETS_REQUIRE_REVIEW")
  )
    items.push({ key: "lyrics", label: "试听并核对歌词与音频" });
  if (!payload.cover) items.push({ key: "cover", label: "导入或选择歌曲封面" });
  if (!work.rights?.trim() || work.ai === "unknown")
    items.push({ key: "rights", label: "补充来源说明与 AI 声明" });
  return {
    state: "checked",
    ready: items.length === 0,
    items,
    next:
      items[0] ?? ({ key: "publish", label: "继续平台资料预检" } as NextItem),
  };
}
