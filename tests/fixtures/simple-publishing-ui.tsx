import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context, PageHead } from "../../src/renderer/context";
import PublishCenter from "../../src/renderer/pages/PublishCenter";

export const song = {
  id: "song-a",
  title: "原版歌曲",
  artistId: "artist-a",
  assets: { audio_A: "audio-a", audio_B: "audio-b", cover: "cover-a" },
  lyrics: "原始歌词",
  config: { language: "中文", genre: "流行" },
};
export const baseData = {
  mode: "production",
  works: [song],
  artists: [{ id: "artist-a", name: "原艺人" }],
  accounts: [],
  bindings: [],
  batches: [],
  units: [],
  targets: [],
  exceptions: [],
  platformConfigurations: [],
  publicationRequests: [],
  publicationPendingTerms: [],
  publishSelection: {
    workIds: [song.id],
    targets: ["netease"],
    accountOverrides: {},
  },
};
export function renderPublish(extra: any = {}) {
  const data = { ...baseData, ...extra },
    actions: any[] = [];
  const html = renderToStaticMarkup(
    <Context.Provider
      value={
        {
          data,
          runtime: { mode: data.mode },
          selected: data.publishSelection.workIds,
          setSelected: () => {},
          call: async (...args: any[]) => actions.push(args),
          go: () => {},
          notify: () => {},
          exportArtifact: () => {},
        } as any
      }
    >
      <PublishCenter />
    </Context.Provider>,
  );
  return { html, actions };
}
export function renderPageHead() {
  return renderToStaticMarkup(
    <PageHead title="测试页面" sub="仅在帮助中阅读的说明" />,
  );
}
