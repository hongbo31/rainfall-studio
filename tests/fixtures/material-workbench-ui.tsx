import React from "react";
import { createRoot } from "react-dom/client";
import { Context } from "../../src/renderer/context";
import Materials from "../../src/renderer/pages/Materials";
import type { MaterialWorkbenchSnapshot } from "../../src/shared/material-workbench";
const check = { path: "fixture/source", exists: true, valid: true };
const entry = (id: string, state: any, number: string) => ({
  id,
  sourceId: "source",
  sourceKey: id,
  number,
  title: id,
  revision: 1,
  contentHash: id,
  lyrics: "Fixture lyrics",
  style: "EXACT numbered Style",
  styleNotes: "Initial20 original note",
  checks: { lyrics: check, style: check, cover: check },
  cover: {
    width: 1024,
    height: 1024,
    previewUrl:
      "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221024%22 height=%221024%22%3E%3Crect width=%221024%22 height=%221024%22 fill=%22purple%22/%3E%3C/svg%3E",
  },
  validationReasons: [],
  state,
  versions: [],
  jobIds: [],
  updatedAt: "",
});
let snapshot: MaterialWorkbenchSnapshot = {
  sources: [{ id: "source", root: "fixture/source", revision: 1 }],
  materials: [
    entry("Pending one", "pending", "01"),
    entry("Pending two", "pending", "02"),
    entry("Generated three", "generated", "03"),
    entry("Failed four", "failed", "04"),
    entry("Unknown five", "unknown", "05"),
  ],
  jobs: [],
  paused: false,
  budget: { limit: 0, reserved: 0, spent: 0, unknown: false },
  generationCapability: {
    available: false,
    reason: "Fixture fee upper bound unavailable",
  },
};
const calls: any[] = [];
snapshot.materials[2].versions = [
  {
    id: "version-a",
    jobId: "prior-job",
    workId: "prior-work",
    assetId: "audio-a",
    version: "A",
    providerSongId: "song-a",
    sha256: "hash-a",
    createdAt: "fixture date",
  },
];
const fixture = {
  calls,
  setMany: () => {
    snapshot = {
      ...snapshot,
      materials: Array.from({ length: 100 }, (_, i) => {
        const m = entry("Material " + (i + 1), "pending", String(i + 1));
        m.cover.previewUrl += "?cover=" + i;
        m.checks = {
          ...m.checks,
          cover: { ...check, path: "fixture/cover-" + (i + 1) + ".png" },
        };
        return m;
      }),
    };
  },
  complete: (id: string) => {
    snapshot = {
      ...snapshot,
      materials: snapshot.materials.map((m) =>
        m.id === id ? { ...m, state: "generated" } : m,
      ),
    };
  },
  setAvailable: () => {
    snapshot = {
      ...snapshot,
      generationCapability: { available: true, reason: "" },
    };
  },
};
(window as any).fixture = fixture;
const context: any = {
  data: { artists: [{ id: "artist", name: "Fixture artist" }] },
  go: (...args: any[]) => calls.push(["go", args]),
  call: async (method: string, input: any) => {
    calls.push([method, input]);
    if (method === "materials.list") return structuredClone(snapshot);
    if (method === "apiProfile.list")
      return [
        {
          id: "music",
          kind: "music",
          label: "Fixture music",
          modelId: "fixture-model",
          revision: 1,
        },
      ];
    if (method === "materials.chooseDirectory") return { id: "source" };
    return {};
  },
};
createRoot(document.getElementById("root")!).render(
  <Context.Provider value={context}>
    <Materials />
  </Context.Provider>,
);
