import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Context } from "../../src/renderer/context";
import PublishCenter from "../../src/renderer/pages/PublishCenter";
import "../../src/renderer/ui-system.css";
const root = createRoot(document.getElementById("root")!);
async function rpc(method: string, input: any = {}) {
  const r = await fetch("/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input }),
  });
  const body = await r.json();
  if (!body.ok) throw Error(body.error);
  return body.value;
}
function Fixture({ initial }: { initial: any }) {
  const [data, setData] = useState(initial),
    [selection, setSelection] = useState(initial.publishSelection);
  const refresh = async () => setData(await rpc("snapshot"));
  (window as any).refreshFixture = refresh;
  (window as any).switchFixtureMode = (mode: string) =>
    setData((d: any) => ({ ...d, mode }));
  const call = async (method: string, input: any) => {
    const value = await rpc(method, input);
    await refresh();
    return value;
  };
  const setPublishSelection = async (next: any) => {
    setSelection(next);
    await call("publish.selection.save", next);
  };
  return (
    <Context.Provider
      value={
        {
          data,
          runtime: { mode: data.mode },
          selected: selection.workIds,
          setSelected: () => {},
          publishSelection: selection,
          setPublishSelection,
          flushPublishSelection: async () => {},
          call,
          refresh,
          go: (page: string, id: string) =>
            ((window as any).lastNavigation = { page, id }),
          notify: () => {},
        } as any
      }
    >
      <main style={{ maxWidth: 1180, margin: "auto", padding: 24 }}>
        <small>离线交互验证 · 不连接音乐平台</small>
        <PublishCenter />
      </main>
    </Context.Provider>
  );
}
(window as any).mountFixture = async () => {
  const data = await rpc("snapshot");
  root.render(<Fixture key={data.fixtureId} initial={data} />);
};
(window as any).rainfall = {
  tmeAiSubmission: async () => ({
    ok: false,
    error: { code: "OFFLINE_TEST_ONLY" },
  }),
};
void (window as any).mountFixture();
