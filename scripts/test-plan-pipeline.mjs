import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
const outfile = path.resolve("output/provider-wiring/plan-pipeline.cjs");
await build({
  stdin: {
    contents: [
      'export {planFanqieAction,planFanqieJobs} from "./src/core/plan-fanqie";',
      'export {createPlanFanqiePublisher} from "./src/main/fanqie/plan-publisher";',
      'export {Studio} from "./src/core/studio";',
      'export {tickPlanCenter,executePlanCenter} from "./src/core/plan-center-integration";',
      'export {planDotStatus} from "./src/core/plan-center-dot";',
      'export {DotDeliveryStore} from "./src/core/inbox/dot-delivery-store";',
      'export {DeepSeekAdapter} from "./src/core/workflow/deepseek";',
      'export {YourMusicAdapter} from "./src/core/workflow/yourmusic";',
      'export {createProductionFlowBroker} from "./src/main/production-flow";',
      'export {importProductionAudio} from "./src/core/production-integration";',
      'export {publicationPayload} from "./src/core/publication-payload";',
      'export {planPublicationStatus} from "./src/core/plan-center-publication";',
      'export {unifiedPublicationService} from "./src/core/unified-publication-integration";',
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  [
    "--require",
    path.resolve("tests/fixtures/managed-music-offline.cjs"),
    "--test",
    "tests/plan-pipeline.test.mjs",
  ],
  {
    windowsHide: true,
    stdio: "inherit",
    env: { ...process.env, RAINFALL_PLAN_PIPELINE_BUNDLE: outfile },
  },
);
process.exit(result.status ?? 1);
