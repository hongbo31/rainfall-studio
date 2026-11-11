import React from "react";
import "../../src/renderer/ui-system.css";
import "../../src/renderer/plan-center.css";
import "../../src/renderer/themes.css";
import { createRoot } from "react-dom/client";
import { Context } from "../../src/renderer/context";
import Materials from "../../src/renderer/pages/Materials";
import type { MaterialWorkbenchSnapshot } from "../../src/shared/material-workbench";
import type { MaterialImportPreview } from "../../src/shared/material-import";
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
let cancelRebind = false,
  chooseNewSource = false,
  rejectConfirm = false;
let preview: MaterialImportPreview = {
  id: "preview-one",
  sourceId: "source",
  root: "fixture/source",
  baseSourceRevision: 1,
  rebind: false,
  format: "folders",
  createdAt: "fixture",
  errors: [],
  warnings: [],
  rows: [
    {
      id: "row-one",
      sourceKey: "song",
      number: "1",
      title: "Suggested title",
      suggestedTitle: "Suggested title",
      lyricsPath: "song/lyrics.txt",
      stylePath: "song/style.txt",
      coverPath: "song/cover.png",
      lyrics: "Preview actual lyrics",
      style: "Preview actual style",
      checks: {
        lyrics: { ...check, path: "fixture/source/song/lyrics.txt" },
        style: { ...check, path: "fixture/source/song/style.txt" },
        cover: { ...check, path: "fixture/source/song/cover.png" },
      },
      cover: entry("preview", "pending", "1").cover,
      candidates: {
        lyrics: ["song/lyrics.txt"],
        style: ["song/style.txt"],
        cover: ["song/cover.png", "song/alternate.jpg"],
      },
      errors: [],
      warnings: [],
      duplicateMaterialIds: ["Pending two"],
      ready: true,
    },
  ],
};
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
  previewSuggestedTitle: () => {
    preview.rows[0].title = "Previously confirmed title";
    preview.rows[0].suggestedTitle = "Changed source title";
  },
  previewMany: (bulkCandidates = false) => {
    preview = {
      ...preview,
      rows: Array.from({ length: 100 }, (_, i) => ({
        ...structuredClone(preview.rows[0]),
        id: "row-" + i,
        sourceKey: "song-" + i,
        title: "Preview " + i,
        suggestedTitle: "Preview " + i,
        duplicateMaterialIds: [],
        duplicateRowIds: [],
        ...(bulkCandidates
          ? {
              candidates: {
                lyrics: Array.from(
                  { length: 200 },
                  (_, n) => `song-${n}/lyrics.txt`,
                ),
                style: Array.from(
                  { length: 200 },
                  (_, n) => `song-${n}/style.txt`,
                ),
                cover: Array.from(
                  { length: 100 },
                  (_, n) => `song-${n}/cover.png`,
                ),
              },
            }
          : {}),
      })),
    };
  },
  previewIssue: (message: string) => {
    preview.rows[0].errors = [message];
    preview.rows[0].ready = false;
    preview.rows[0].checks.cover = {
      path: "fixture/source/song/cover.png",
      exists: true,
      valid: false,
      reason: message,
    };
  },
  cancelRebind: () => {
    cancelRebind = true;
  },
  chooseNewSource: () => {
    chooseNewSource = true;
  },
  rejectConfirm: () => {
    rejectConfirm = true;
  },
  previewInternalDuplicate: () => {
    preview.rows[0].duplicateMaterialIds = [];
    preview.rows[0].duplicateRowIds = ["other-preview-row"];
  },
  previewMissing: () => {
    preview.rows[0].coverPath = "";
    preview.rows[0].ready = false;
    preview.rows[0].errors = ["cover_missing"];
    preview.rows[0].cover.previewUrl = "";
    preview.rows[0].checks.cover = {
      path: "",
      exists: false,
      valid: false,
      reason: "cover_missing",
    };
  },
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
    if (method === "materials.previewScan") return structuredClone(preview);
    if (method === "materials.chooseRebindDirectory") {
      if (cancelRebind) return null;
      preview = { ...preview, rebind: true, root: "fixture/moved-source" };
      return structuredClone(preview);
    }
    if (method === "materials.updatePreview") {
      preview = {
        ...preview,
        rows: preview.rows.map((row) =>
          row.id === input.rowId
            ? {
                ...row,
                ...input,
                ready: !!input.coverPath,
                errors: input.coverPath ? [] : ["cover_missing"],
                cover: {
                  ...row.cover,
                  previewUrl: entry("preview", "pending", "1").cover.previewUrl,
                },
                checks: {
                  ...row.checks,
                  cover: {
                    ...check,
                    path: "fixture/source/" + input.coverPath,
                  },
                },
              }
            : row,
        ),
      };
      return structuredClone(preview);
    }
    if (method === "materials.confirmImport") {
      if (rejectConfirm) throw Error("SOURCE_CHANGED_RESCAN_REQUIRED");
      snapshot = {
        ...snapshot,
        materials: [
          ...snapshot.materials,
          ...preview.rows
            .filter((r) => input.rowIds.includes(r.id))
            .map((r) => ({
              ...entry(r.id, "pending", r.number),
              title: r.title,
            })),
        ],
      };
      return structuredClone(snapshot);
    }
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
    if (method === "materials.chooseDirectory") {
      if (chooseNewSource)
        snapshot = {
          ...snapshot,
          sources: [
            ...snapshot.sources,
            { id: "new-source", root: "fixture/new-source", revision: 1 },
          ],
        };
      return structuredClone(snapshot);
    }
    return {};
  },
};
createRoot(document.getElementById("root")!).render(
  <Context.Provider value={context}>
    <Materials />
  </Context.Provider>,
);
