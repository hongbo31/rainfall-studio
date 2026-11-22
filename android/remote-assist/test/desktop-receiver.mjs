import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const [java, appClasses, androidJar, buildRoot, dependencyRoot] = process.argv.slice(2);
assert.ok(java && appClasses && androidJar && buildRoot && dependencyRoot,
  "Pass java.exe, compiled classes, android.jar, isolated build root and the desktop dependency root");
const base = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(base, "../../..");
const requireDesktop = createRequire(path.resolve(dependencyRoot, "package.json"));
const { build } = requireDesktop("esbuild");
const sharp = requireDesktop("sharp");
const compiled = await build({
  absWorkingDir: repo, entryPoints: ["src/main/sms-inbox.ts"], nodePaths: [path.join(dependencyRoot, "node_modules")],
  platform: "node", target: "node24", format: "esm", write: false, bundle: true,
});
const { SmsInbox } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].contents).toString("base64"));
const directory = await mkdtemp(path.join(buildRoot, "receiver-smoke-"));
const testClasses = path.join(directory, "classes");
await promisify(execFile)(path.join(path.dirname(java), "javac.exe"), ["--release", "17", "-encoding", "UTF-8",
  "-cp", [appClasses, androidJar].join(path.delimiter), "-d", testClasses,
  path.join(base, "com/rainfallstudio/sms/InboxClientSmoke.java")], { windowsHide: true });
const inbox = new SmsInbox({ directory: path.join(directory, "data"), interfaces: () => [{ address: "127.0.0.1", label: "Fixture" }] });
let clientProcess;
let timeout;
try {
  const { endpoint } = await inbox.ui("start", { address: "127.0.0.1" });
  await inbox.ui("pair", { code: "682149" });
  clientProcess = spawn(java, ["-cp", [appClasses, testClasses, androidJar].join(path.delimiter),
    "com.rainfallstudio.sms.InboxClientSmoke", endpoint], { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
  const finished = once(clientProcess, "close");
  // Observe launch errors even if they close the output stream before the loop finishes.
  finished.catch(() => {});
  timeout = setTimeout(() => clientProcess.kill(), 20_000);
  let sawDelivery = false, sawFrame = false;
  for await (const line of createInterface({ input: clientProcess.stdout })) {
    if (line === "FRAMED") {
      const { session } = await inbox.remoteUi("status");
      assert.equal(session.phase, "active");
      assert.equal(session.frame.seq, 1);
      assert.ok(session.frame.jpeg);
      await inbox.remoteUi("input", { id: session.id, command: { seq: 1, kind: "back" } });
      sawFrame = true;
      clientProcess.stdin.end("continue\n");
      continue;
    }
    if (line !== "DELIVERED") continue;
    const { devices, notices, arrivals } = await inbox.ui("status");
    assert.deepEqual(devices.map(({ name, online, listening }) => [name, online, listening]), [["隔离测试手机", true, true]]);
    assert.equal(arrivals.length, 2);
    assert.equal(new Set(arrivals.map(arrival => arrival.id)).size, 2);
    for (const arrival of arrivals) {
      assert.deepEqual(Object.keys(arrival).sort(), ["deviceId", "deviceName", "id", "receivedAt"]);
      assert.equal(arrival.deviceId, devices[0].id);
      assert.equal(arrival.deviceName, devices[0].name);
      assert.equal(arrival.receivedAt, arrivals[0].receivedAt);
    }
    const expected = {
      platform: "fanqie", status: "approved", title: "雨夜", deviceName: "隔离测试手机",
    };
    assert.deepEqual(notices.map(({ platform, status, title, deviceName }) => ({ platform, status, title, deviceName })),
      [expected, expected]);
    assert.equal(new Set(notices.map(notice => notice.id)).size, 2);
    sawDelivery = true;
    await inbox.remoteUi("request", { deviceId: devices[0].id, mode: "rainfall" });
    const jpeg = await sharp({ create: { width: 8, height: 16, channels: 3, background: "#654892" } }).jpeg().toBuffer();
    clientProcess.stdin.write(jpeg.toString("base64") + "\n");
  }
  assert.deepEqual(await finished, [0, null]);
  assert.ok(sawDelivery && sawFrame);
  assert.equal((await inbox.remoteUi("status")).session, null);
  const unpaired = await inbox.ui("status");
  assert.equal(unpaired.devices.length, 0);
  assert.equal(unpaired.notices.length, 2);
  assert.equal(unpaired.arrivals.length, 2);
  console.log("Java client: pairing, SMS arrivals, notices, consent, frames, input, stop and unpair passed");
} finally {
  clearTimeout(timeout);
  if (clientProcess?.exitCode === null && clientProcess?.signalCode === null) clientProcess.kill();
  await inbox.close();
}
