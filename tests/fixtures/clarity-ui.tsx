import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context } from "../../src/renderer/context";
import Insights from "../../src/renderer/pages/Insights";
import Overview from "../../src/renderer/pages/Overview";
export { describeWorkReadiness } from "../../src/renderer/work-readiness";
export { renderTmeStudio } from "./tme-ui";
const baseData = {
  mode: "production",
  works: [],
  artists: [],
  series: [],
  plans: [],
  runs: [],
  exceptions: [],
  resources: {
    finished: 0,
    cost: { available: 0, reserved: 0 },
    candidate: { available: 0, spent: 0, reserved: 0 },
  },
};
export function renderOverview() {
  return renderToStaticMarkup(
    <Context.Provider
      value={
        {
          data: baseData,
          go: () => {},
          call: async () => {},
          notify: () => {},
        } as any
      }
    >
      <Overview />
    </Context.Provider>,
  );
}
export {
  summarizeReports,
  reportScopeKey,
} from "../../src/renderer/insights-summary";
export function renderInsights(metrics: any[] = []) {
  return renderToStaticMarkup(
    <Context.Provider
      value={{ data: { metrics }, importAsset: async () => {} } as any}
    >
      <Insights />
    </Context.Provider>,
  );
}
