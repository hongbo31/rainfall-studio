import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Context, type StudioContext } from "../../src/renderer/context";
import AccountBinding from "../../src/renderer/components/AccountBinding";
export function renderAccountBinding(provider = "tme") {
  const value: StudioContext = {
    data: {
      artists: [{ id: "artist", name: "Offline artist" }],
      accounts: [{ id: "account", provider, name: "Offline account" }],
    },
    runtime: { mode: "production" },
    call: async () => [],
    refresh: async () => {},
    notify: () => {},
    go: () => {},
    play: () => {},
    selected: [],
    setSelected: () => {},
    importAsset: async () => {},
    exportArtifact: async () => {},
  };
  return renderToStaticMarkup(
    <Context.Provider value={value}>
      <AccountBinding artistId="artist" accountId="account" />
    </Context.Provider>,
  );
}
