/** Compare renderer regressions using one current Core and one browser installation.
 * Every run creates a synthetic SQLite/media root; no external RPC is allowed.
 * Ref overrides change only PublishCenter source through esbuild, never the checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
const refs = [
  ["baseline", "b6296ff"],
  ["candidate", "c6f84c9"],
  ["fixed", null],
];
const dir = path.resolve("output/publish-material-feedback");
fs.mkdirSync(dir, { recursive: true });
const report = {
  recordedAt: new Date().toISOString(),
  coreSourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  scope:
    "Same working Core, fixtures, installed headless Chromium; only PublishCenter renderer source differs. Local synthetic SQLite/media. Non-local requests aborted.",
  runs: [],
};
for (const [tag, ref] of refs) {
  const env = { ...process.env, FEEDBACK_RUN_TAG: tag };
  delete env.FEEDBACK_PUBLISH_CENTER_REF;
  if (ref) env.FEEDBACK_PUBLISH_CENTER_REF = ref;
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "tests/publish-material-feedback-ui.test.mjs",
    ],
    { env, encoding: "utf8", timeout: 90000, maxBuffer: 4e6 },
  );
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  fs.writeFileSync(path.join(dir, tag + ".tap"), output);
  const evidencePath = path.join(dir, tag, "boundary-evidence.json");
  const evidence = fs.existsSync(evidencePath)
    ? JSON.parse(fs.readFileSync(evidencePath, "utf8"))
    : null;
  const run = {
    tag,
    ref: ref ?? "working-tree",
    exitCode: result.status,
    pass: Number(output.match(/# pass (\d+)/)?.[1] ?? 0),
    fail: Number(output.match(/# fail (\d+)/)?.[1] ?? 0),
    failedTests: [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]),
    evidence,
  };
  report.runs.push(run);
  console.log(tag + ": " + run.pass + " passed, " + run.fail + " failed");
}
report.sameCore = report.runs.every(
  (r) => r.evidence?.coreSha256 === report.runs[0].evidence?.coreSha256,
);
report.sameBrowser = report.runs.every(
  (r) => r.evidence?.browser === report.runs[0].evidence?.browser,
);
report.sameHistoricalFailures =
  JSON.stringify(report.runs[0].failedTests) ===
  JSON.stringify(report.runs[1].failedTests);
report.sameFixtures = report.runs.every(
  (r) =>
    r.evidence?.testSha256 === report.runs[0].evidence?.testSha256 &&
    r.evidence?.fixtureSha256 === report.runs[0].evidence?.fixtureSha256,
);
report.noExternalOperations = report.runs.every((r) =>
  r.evidence?.tests.every(
    (t) => t.externalRequests === 0 && t.operations === 0,
  ),
);
report.accepted =
  report.sameFixtures &&
  report.noExternalOperations &&
  report.sameCore &&
  report.sameBrowser &&
  report.sameHistoricalFailures &&
  report.runs[0].pass === 1 &&
  report.runs[0].fail === 9 &&
  report.runs[1].pass === 1 &&
  report.runs[1].fail === 9 &&
  report.runs[2].pass === 10 &&
  report.runs[2].fail === 0;
fs.writeFileSync(
  path.join(dir, "comparison.json"),
  JSON.stringify(report, null, 2),
);
fs.writeFileSync(
  path.join(dir, "comparison.md"),
  [
    "# Publication feedback comparison",
    "",
    "Same current Core and headless browser; only PublishCenter source changes. No tests or timeouts removed or weakened.",
    "",
    "| Renderer | Passed | Failed |",
    "| --- | ---: | ---: |",
    ...report.runs.map(
      (r) => "| " + r.ref + " | " + r.pass + " | " + r.fail + " |",
    ),
    "",
    "Identical Core: " +
      report.sameCore +
      ". Identical browser: " +
      report.sameBrowser +
      ". Identical fixtures: " +
      report.sameFixtures +
      ". Historical failing test names match: " +
      report.sameHistoricalFailures +
      ". No external operations: " +
      report.noExternalOperations +
      ".",
    "",
    "Root cause: both historical renderers suppress the current material-check section and historical stale-material repair information whenever a persisted pipeline job exists. publish.simple always creates such jobs in production mode. The request snapshots exist, but the rendering guard hides them.",
    "",
    "Fix: render the local material-check result and material history alongside the existing durable queue. Official status, queue submission guards, terms and transport remain unchanged. All ten original assertions scenarios remain; an additional assertion requires the durable queue to remain visible.",
    "",
    "Evidence: comparison.json includes source/test/fixture/Core hashes, installed browser version, exact failed test names, request stale flags, pipeline states, displayed sections, externalRequests and operations. baseline.tap, candidate.tap and fixed.tap preserve runner output.",
  ].join("\n"),
);
if (!report.accepted) process.exitCode = 1;
