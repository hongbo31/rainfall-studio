import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Context } from "../../src/renderer/context";
import PublishCenter from "../../src/renderer/pages/PublishCenter";
const assets = [
  { id: "audio-a", kind: "audio", bytes: 100, sha256: "a" },
  { id: "audio-b", kind: "audio", bytes: 100, sha256: "b" },
];
function Fixture() {
  const [selection, setSelection] = useState<any>({
      workIds: [],
      targets: [],
      accountOverrides: {},
    }),
    [work, setWork] = useState({
      id: "work-ready",
      title: "Ready Song",
      revision: 1,
      assets: { audio_A: "audio-a", audio_B: "audio-b" },
      selectedAudioVariant: "A",
    });
  return (
    <Context.Provider
      value={
        {
          data: {
            mode: "production",
            works: [work, { id: "work-empty", title: "No audio", assets: {} }],
            assets,
            artists: [],
            accounts: [],
            publicationPipelineJobs: [],
            materialWorkbench: { materials: [], sources: [] },
          },
          publishSelection: selection,
          selected: selection.workIds,
          setPublishSelection: async (next: any) => {
            setSelection(next);
          },
          call: async (method: string, input: any) => {
            (window as any).lastCall = { method, input };
            if (method === "work.selectAudioVersion")
              setWork({
                ...work,
                revision: 2,
                selectedAudioVariant: input.version,
              });
            return {};
          },
          refresh: async () => {},
          go: () => {},
          setSelected: () => {},
          notify: () => {},
        } as any
      }
    >
      <PublishCenter />
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
