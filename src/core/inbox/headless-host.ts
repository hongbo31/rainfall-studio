// Temporary windowless receipt acceptance host; no OS registration or model/music/publish tick.
import fs from "node:fs";
import path from "node:path";
import { Studio } from "../studio";
import { acquireWorkspaceLease } from "../../main/session-runtime";
import { validateBridgeProject } from "./dot-delivery-bridge";
async function main() {
  const args = process.argv.slice(2),
    get = (key: string) => {
      const i = args.indexOf(key);
      return i < 0 ? undefined : args[i + 1];
    };
  const rawRoot = get("--data-root"),
    rawProject = get("--project");
  if (
    !rawRoot ||
    !rawProject ||
    !path.isAbsolute(rawRoot) ||
    !path.isAbsolute(rawProject)
  )
    throw Error("EXPLICIT_ABSOLUTE_PATHS_REQUIRED");
  const root = path.resolve(rawRoot),
    project = path.resolve(rawProject),
    inboxRoot = path.join(root, "production", "inbox-v1");
  validateBridgeProject(project, inboxRoot);
  const minutes = Number(get("--watch-minutes") ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)
    throw Error("WATCH_DURATION_REJECTED");
  const lease = await acquireWorkspaceLease(root),
    studio = new Studio(root, "production"),
    controller = studio.inboxController();
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const statusFile = path.join(runtime, "dot-inbox-host-status.json"),
    stopFile = path.join(runtime, "dot-inbox-host.stop");
  const report: Record<string, any> = {
    pid: process.pid,
    dataRoot: root,
    projectRoot: project,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),
    mode: "windowless-inbox-only",
    cloudTransportVerified: false,
    accountIdentity: "user-confirmed; email not independently visible",
    sourceCommit: process.env.RAINFALL_SOURCE_COMMIT ?? null,
  };
  let stopped = false;
  const stop = () => {
    stopped = true;
    controller.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (!controller.status().configured)
      controller.configure({
        workspaceRef: "rainfall-personal",
        artistRef: "creator",
        artistId: studio.all("artists")[0].id,
        seriesRef: null,
        seriesId: null,
        expectedRevision: 0,
      });
    const current = controller.status().bridge;
    if (!current.configured || current.projectRoot !== project)
      controller.configureBridge(
        { projectRoot: project, expectedRevision: current.revision },
        "authorized-local-setup",
      );
    else if (!current.enabled)
      controller.setBridgeEnabled(true, current.revision);
    do {
      if (fs.existsSync(stopFile)) break;
      await controller.scanOnce();
      Object.assign(report, {
        observedAt: new Date().toISOString(),
        status: controller.status(),
        counts: {
          textCandidates: studio.all("textCandidates").length,
          assets: studio.all("assets").length,
          works: studio.all("works").length,
          operations: studio.all("operations").length,
        },
      });
      const temp = statusFile + ".partial";
      fs.writeFileSync(temp, JSON.stringify(report, null, 2));
      fs.renameSync(temp, statusFile);
      if (!minutes || stopped || Date.now() >= Date.parse(report.expiresAt))
        break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } while (!stopped);
  } finally {
    report.stoppedAt = new Date().toISOString();
    controller.stop();
    studio.close();
    await lease.release();
    fs.writeFileSync(statusFile, JSON.stringify(report, null, 2));
  }
  console.log(
    JSON.stringify({ statusFile, counts: report.counts, projectRoot: project }),
  );
}
void main().catch((e) => {
  console.error(
    /^[A-Z0-9_]+$/.test(e?.message ?? "") ? e.message : "INBOX_HOST_FAILED",
  );
  process.exitCode = 1;
});
