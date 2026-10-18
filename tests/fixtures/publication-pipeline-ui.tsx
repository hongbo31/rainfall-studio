import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Context } from "../../src/renderer/context";
import PublishCenter from "../../src/renderer/pages/PublishCenter";
const workId = "new-cloud-work";
const task = {
  id: "pipeline-1",
  workId,
  title: "云端新歌",
  targets: ["qqmusic"],
  state: "queued",
  revision: 1,
  summary: "等待准备",
};
const initial = {
  mode: "production",
  works: [{ id: workId, title: "云端新歌", assets: { audio_A: "a" } }],
  artists: [],
  accounts: [],
  publicationRequests: [],
  publicationPipelineJobs: [],
};
const w = window as any;
w.calls = [];
w.refreshCount = 0;
w.nextState = "queued";
w.rainfall = {
  tmeAiPrepare: async (action: string, input: any) => {
    w.calls.push({ action, input });
    return {
      ok: true,
      value:
        action === "list"
          ? { grants: [], jobs: [] }
          : action === "inspect"
            ? {
                identity: {
                  qqDisplayName: "云端测试账号",
                  artistName: "测试艺人",
                  maskedKugouId: "***1234",
                },
                authorizationNonce: "offline-inspection-nonce",
                binding: { transport: "cloud-playwright", sessionId: "offline-session", pageId: "offline-page", started: "2026-10-18T00:00:00.000Z" },
                page: {},
              }
            : {},
    };
  },
  tmeAiSubmission: async (action: string, input: any) => {
    w.calls.push({ action, input });
    return {
      ok: true,
      value: {
        ready: true,
        capability: { available: true },
        job: {
          id: "submission-1",
          state: "reviewed",
          termsText: "本首歌曲非独家授权三年",
          termsHash: "hash",
          revision: 1,
        },
      },
    };
  },
};
function Fixture() {
  const [data, setData] = useState<any>(initial),
    [selection, setSelection] = useState<any>({
      workIds: [workId],
      targets: ["qqmusic"],
      accountOverrides: {},
    });
  const refresh = async () => {
    w.refreshCount++;
    setData((d: any) => ({
      ...d,
      publicationPipelineJobs: [{ ...task, state: w.nextState }],
    }));
  };
  w.setStage = (state: string) => {
    w.nextState = state;
    return refresh();
  };
  return (
    <Context.Provider
      value={
        {
          data,
          selected: selection.workIds,
          publishSelection: selection,
          setPublishSelection: async (s: any) => setSelection(s),
          refresh,
          call: async (method: string, input: any) => {
            w.calls.push({ method, input });
            if (method === "publish.simple") {
              setData((d: any) => ({ ...d, publicationPipelineJobs: [task] }));
              return { requests: [], pipeline: [task] };
            }
          },
          go: () => {},
          notify: () => {},
        } as any
      }
    >
      <PublishCenter />
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
