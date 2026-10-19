import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context, type StudioContext } from "../../src/renderer/context";
import ChatCreation from "../../src/renderer/pages/ChatCreation";
import ProductionFlowWorkspace from "../../src/renderer/components/ProductionFlowWorkspace";
import { defaultsSchema } from "../../src/shared/schemas";
import type { Mode } from "../../src/shared/contracts";

function workflowContext(mode: Mode): StudioContext {
  // Match the persisted artist contract consumed by ManualCreation, not just SelectArtist.
  const defaults = defaultsSchema.parse({
    genre: "流行 / 民谣",
    voice: "female",
    lyricTone: "克制叙事",
    bpmMin: 72,
    bpmMax: 96,
    coverStyle: "雨夜留白",
    instruments: "钢琴、木吉他",
    seriesStory: "从相识到熟悉，最后告白",
    language: "中文",
    mood: "温柔",
    duration: 180,
  });
  return {
    data: {
      mode,
      artists: [
        {
          id: "50951bc4-599e-49eb-b604-bba5b2f87122",
          name: "隔离测试艺人",
          revision: 7,
          defaults,
        },
      ],
      series: [],
    },
    runtime: {},
    selected: [],
    call: () => {
      throw Error("SSR_MUST_NOT_CALL_CORE");
    },
    refresh: async () => {},
    notify: () => {},
    go: () => {},
    play: () => {},
    setSelected: () => {},
    importAsset: () => {
      throw Error("SSR_MUST_NOT_IMPORT_MEDIA");
    },
    exportArtifact: () => {
      throw Error("SSR_MUST_NOT_EXPORT_ARTIFACT");
    },
  };
}
export function renderWorkflow(mode: Mode) {
  const value = workflowContext(mode);
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <ChatCreation />
    </Context.Provider>,
  );
}
// The legacy scheduler no longer belongs to ChatCreation. Cover its real component
// separately so scheduling/publication gates do not disappear from this regression.
export function renderProductionWorkflow(mode: Mode) {
  const value = workflowContext(mode);
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <ProductionFlowWorkspace />
    </Context.Provider>,
  );
}
