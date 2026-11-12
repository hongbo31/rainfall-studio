import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const dir = path.resolve("output/publication-music-tests");
fs.mkdirSync(dir, { recursive: true });
await build({
  entryPoints: {
    list: "src/renderer/components/PublicationMusicList.tsx",
    status: "src/renderer/publication-status.ts",
  },
  outdir: dir,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  loader: { ".css": "empty" },
});
const { publicationState, readyVersions } = createRequire(import.meta.url)(
  path.join(dir, "list.cjs"),
);
const { libraryPublicationIndex } = createRequire(import.meta.url)(path.join(dir, "status.cjs"));
test("ready audio requires an existing real audio record, bytes and hash", () => {
  const work = { id: "w", assets: { audio_A: "a", audio_B: "b" } };
  assert.equal(readyVersions({ assets: [] }, work).length, 0);
  assert.deepEqual(
    readyVersions(
      {
        assets: [
          { id: "a", kind: "audio", bytes: 44, sha256: "hash" },
          { id: "b", kind: "audio", bytes: 0, sha256: "hash" },
        ],
      },
      work,
    ).map((v) => v.version),
    ["A"],
  );
});
test("status is per platform and local queue never counts as official publication", () => {
  const job = { workId: "w", targets: ["qqmusic", "kugou"], state: "queued" };
  assert.equal(
    publicationState({ publicationPipelineJobs: [job] }, "w", "qqmusic"),
    "unpublished",
  );
  job.state = "published";
  assert.equal(
    publicationState({ publicationPipelineJobs: [job] }, "w", "qqmusic"),
    "unknown",
  );
  job.receipt = { source: "official-tencent-review-record" };
  assert.equal(
    publicationState({ publicationPipelineJobs: [job] }, "w", "qqmusic"),
    "published",
  );
  assert.equal(
    publicationState({ publicationPipelineJobs: [job] }, "w", "kugou"),
    "published",
  );
  assert.equal(
    publicationState({ publicationPipelineJobs: [job] }, "w", "netease"),
    "unpublished",
  );
});
test("library combines exact Fanqie receipts and submitted targets while excluding title matches and preparation", () => {
  const pipeline = {
    workId: "work",
    targets: ["qqmusic", "kugou"],
    state: "reviewing",
    receipt: { source: "official-tencent-review-record" },
  };
  const pending = { id: "7707161465513331736", title: "Same title", stage: "contract_pending" };
  const statuses = libraryPublicationIndex({
    publicationPipelineJobs: [
      pipeline,
      { ...pipeline, state: "queued", updatedAt: "2026-11-12T09:00:00Z" },
      { ...pipeline, state: "reconcile_required", updatedAt: "2026-11-12T10:00:00Z" },
    ],
    tmeObservations: [
      { workId: "prepared-only", status: "prepared" },
      { workId: "manual", status: "released" },
    ],
  }, [
    { workId: "work", state: "uploaded", updatedAt: "2026-11-12T08:00:00Z", record: { ...pending, stage: "reviewing" } },
    { workId: "work", updatedAt: "2026-11-12T07:00:00Z", officialRecord: pending },
    { workId: "other-work", state: "existing", record: pending },
  ]);
  assert.deepEqual(
    [...statuses.get("work")].map(([platform, entry]) => [platform, entry.state]),
    [["qqmusic", "reviewing"], ["kugou", "reviewing"], ["fanqie", "reviewing"]],
  );
  assert.equal(statuses.has("other-work"), false);
  assert.equal(statuses.has("prepared-only"), false);
  assert.equal(statuses.get("manual").get("tme").label, "已发行（手工记录）");
});
