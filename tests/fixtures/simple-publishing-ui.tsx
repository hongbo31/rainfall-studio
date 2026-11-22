import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context, PageHead } from "../../src/renderer/context";
import PublishCenter from "../../src/renderer/pages/PublishCenter";
import PublicationTaskEditor from "../../src/renderer/components/PublicationTaskEditor";
import type { PublicationTask } from "../../src/shared/publication-tasks";

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
  assets: [
    {id:"audio-a",kind:"audio",bytes:1024,sha256:"a".repeat(64)},
    {id:"audio-b",kind:"audio",bytes:1024,sha256:"b".repeat(64)},
  ],
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
export function renderPublicationTaskEditor() {
  const plans = [{ id: "plan-a", title: "关联计划甲", revision: 1 }, { id: "plan-b", title: "关联计划乙", revision: 3 }];
  const initial: PublicationTask = {
    id: "task-a", title: "发布任务", enabled: true, revision: 1, cursor: "2026-11-19T03:00:00Z", consent: true,
    execution: { kind: "scheduled", unit: "month", day: 31, localTime: "09:00" },
    steps: [{ kind: "plans", planIds: plans.map(row => row.id) },
      { kind: "publish", targets: [{ platform: "qqmusic", accountId: "account-a" }] }],
  };
  return renderToStaticMarkup(<Context.Provider value={{ data: {
    accounts: [{ id: "account-a", name: "腾讯账号", provider: "tme" }],
  } } as any}><PublicationTaskEditor initial={initial} plans={plans} busy={false} onSave={() => {}} onClose={() => {}} /></Context.Provider>);
}
