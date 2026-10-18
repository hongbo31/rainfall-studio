import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context } from "../../src/renderer/context";
import ApiSettings from "../../src/renderer/components/ApiSettings";
import TextCandidates from "../../src/renderer/components/TextCandidates";
export function renderInboxSettings() {
  const value: any = {
    runtime: { mode: "production" },
    data: { artists: [], series: [] },
    call: () => {
      throw Error("SSR_MUST_NOT_CALL_CORE");
    },
    notify: () => {},
  };
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <ApiSettings />
      <TextCandidates />
    </Context.Provider>,
  );
}
