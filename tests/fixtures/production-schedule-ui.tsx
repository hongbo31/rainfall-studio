import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context } from "../../src/renderer/context";
import * as workspace from "../../src/renderer/components/ProductionFlowWorkspace";

export function renderProductionDefaults() {
  const value: any = {
    data: {
      mode: "production",
      artists: [{ id: "artist", name: "Offline artist" }],
    },
    go: () => {},
    notify: () => {},
    refresh: async () => {},
    call: () => {
      throw Error("SSR_MUST_NOT_CALL_CORE");
    },
  };
  const Workspace = workspace.default;
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <Workspace />
    </Context.Provider>,
  );
}
export function renderProductionSchedule(plan: any, now: string) {
  const Schedule = (workspace as any).ProductionFlowSchedule;
  if (typeof Schedule !== "function") throw Error("SCHEDULE_COMPONENT_MISSING");
  return renderToStaticMarkup(<Schedule plan={plan} now={new Date(now)} />);
}
