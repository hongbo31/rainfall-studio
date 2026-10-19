import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Context } from "../../src/renderer/context";
import PlanAlbumFields from "../../src/renderer/components/PlanAlbumFields";
import PlanAlbumOperations from "../../src/renderer/components/PlanAlbumOperations";
import "../../src/renderer/ui-system.css";
import "../../src/renderer/plan-center.css";
function Fixture() {
  const [target, setTarget] = useState<any>({
    platform: "qqmusic",
    accountId: "fixture-account",
    enabled: true,
    album: { mode: "existing", albumId: "" },
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const call = (method: string, input?: any) =>
    (window as any).__albumRpc(method, input ?? {});
  const run: any = {
    id: "fixture-run",
    stopRequested: false,
    snapshot: { publishTargets: [target] },
  };
  const item: any = {
    id: "fixture-item",
    ordinal: 1,
    materialFingerprint: "fixture-material",
  };
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Context.Provider value={{ call } as any}>
      <main className="plan-center">
        <h1>专辑链路 · 离线夹具</h1>
        <p>真实组件的无头浏览器验证 · 线上未验证</p>
        {error && <p role="alert">{error}</p>}
        <section className="plan-editor">
          <button type="button" onClick={()=>setTarget({...target,platform:'netease'})}>Fixture unsupported platform</button>
          <PlanAlbumFields
            target={target}
            index={0}
            update={(changes) => setTarget({ ...target, ...changes })}
            busy={busy}
          />
          <label>
            夹具账号
            <select
              aria-label="Fixture account"
              value={target.accountId}
              onChange={(e) =>
                setTarget({
                  ...target,
                  accountId: e.target.value,
                  album: { mode: "existing", albumId: "" },
                })
              }
            >
              <option value="fixture-account">A</option>
              <option value="fixture-account-b">B</option>
            </select>
          </label>
        </section>
        <PlanAlbumOperations run={run} items={[item]} busy={busy} act={act} />
        <output aria-label="Selected album snapshot">
          {JSON.stringify(target.album)}
        </output>
      </main>
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
