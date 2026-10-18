import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TmeAiPrepareWorkspace, {
  TmeAiPreparePanel,
} from "../../src/renderer/components/TmeAiPrepareWorkspace";
const workId = "00000000-0000-4000-8000-000000000002";
const grant = {
  id: "grant-a",
  revision: 3,
  workId,
  title: "示例作品A",
  variant: "A",
  scope: "prepare_only",
  identity: {
    subjectType: "official_visible_binding_fingerprint",
    maskedKugouId: "***1234",
    qqDisplayName: "原QQ账户",
    artistName: "云端测试艺人",
  },
};
const inspection = {
  identity: { ...grant.identity, observedAt: "2026-10-16T20:00:00Z" },
  binding: { pid: 43208, handle: "920456", started: "2026-10-16T12:00:00Z" },
  page: {
    mode: "editor",
    route: "https://y.tencentmusic.com/#/user/manage/aiChoose/add",
  },
  registered: true,
};
const data = {
  mode: "production",
  works: [
    {
      id: workId,
      title: "示例作品A",
      assets: { audio_A: "original-a", audio_B: "forbidden-b" },
    },
    { id: "other-work", title: "未授权作品", assets: { audio_A: "other-a" } },
  ],
};
export function renderAiPrepare(options: any = {}) {
  const job = {
    id: "job-a",
    grantId: grant.id,
    workId,
    revision: 7,
    state: options.state ?? "ready",
    step: options.step ?? "fill_metadata",
    reason: options.reason ?? null,
    submissionByClient: false,
    remoteId: null,
    updatedAt: "2026-10-16T20:01:00Z",
    terms: options.terms ?? null,
    localAlbumSnapshot: options.localAlbumSnapshot ?? null,
  };
  return renderToStaticMarkup(
    <TmeAiPreparePanel
      data={data}
      workId={workId}
      inspection={inspection}
      grants={[grant]}
      jobs={[job]}
      context={{ grant, job }}
      consent={true}
      busy={false}
      error=""
      onSelectWork={() => {}}
      onConsent={() => {}}
      onAction={() => {}}
      {...options}
    />,
  );
}
export function renderAiPrepareDefault(mode = "production") {
  return renderToStaticMarkup(
    <TmeAiPrepareWorkspace
      data={{ ...data, mode }}
      notify={() => {
        throw Error("SSR_MUST_NOT_NOTIFY");
      }}
    />,
  );
}
