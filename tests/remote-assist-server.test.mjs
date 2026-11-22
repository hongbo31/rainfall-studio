import assert from "node:assert/strict";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import sharp from "sharp";

const compiled = await build({
  entryPoints: ["src/main/remote-assist-server.ts"],
  platform: "node", target: "node24", bundle: true, format: "esm", write: false,
});
const { RemoteAssistServer, remoteAssistNetworkInterfaces } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].contents).toString("base64")
);
const loopback = { address: "127.0.0.1", label: "Test loopback" };

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rainfall-remote-assist-"));
  const now = { value: Date.now() };
  const options = { directory, apkDirectory: path.join(directory, "apk"), interfaces: () => [loopback], now: () => now.value };
  const server = new RemoteAssistServer(options);
  t.after(async () => {
    await server.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { server, directory, now, options };
}

async function phone(endpoint, directory) {
  const url = new URL(endpoint);
  const identity = JSON.parse(await fs.readFile(path.join(directory, "identity.json"), "utf8"));
  const pin = createHash("sha256").update(new X509Certificate(identity.cert).raw).digest("hex");
  assert.equal(url.hash, "#" + pin);
  return (route, value, token, headers = {}) => new Promise((resolve, reject) => {
    const body = JSON.stringify(value);
    const request = https.request(new URL(route, url), {
      method: "POST", agent: false, ca: identity.cert,
      checkServerIdentity: (_host, cert) => {
        const peer = createHash("sha256").update(cert.raw).digest("hex");
        return peer === pin ? undefined : new Error("Receiver certificate mismatch");
      },
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        ...(token ? { Authorization: "Bearer " + token } : {}), ...headers },
    }, async response => {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    });
    request.once("error", reject);
    request.end(body);
  });
}

const assistFrame = (await sharp({ create: { width: 8, height: 16, channels: 3, background: "#654892" } })
  .jpeg().toBuffer()).toString("base64");

async function pairAssistPhone(server, post, code, name) {
  await server.connectionUi("pair", { code });
  const result = await post("/v1/pair", { code, name });
  assert.equal(result.status, 200);
  return result.body;
}

test("the remote assistant accepts a paired device and refuses the removed message routes", async t => {
  const { server, directory } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const { token } = await pairAssistPhone(server, post, "357192", "测试手机");
  assert.equal((await post("/v1/assist/poll", {}, token)).status, 200);
  for (const route of ["/v1/heartbeat", "/v1/arrivals", "/v1/notices"]) {
    assert.equal((await post(route, { listening: true }, token)).status, 404);
  }
});

test("an authenticated installation replaces its own pairing, rotates its token, and keeps other devices", async t => {
  const { server, directory, now } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const old = await pairAssistPhone(server, post, "731582", "同名手机");
  const other = await pairAssistPhone(server, post, "297381", "同名手机");
  const key = Buffer.alloc(32, 21).toString("base64url");
  assert.equal((await post("/v1/assist/poll", { installationKey: key })).status, 401);
  assert.equal((await post("/v1/assist/poll", { installationKey: key }, old.token)).status, 200);
  assert.equal((await post("/v1/assist/poll", { installationKey: key }, other.token)).status, 409);
  const { session } = await server.remoteUi("request", { deviceId: old.deviceId, mode: "rainfall" });
  assert.equal((await post("/v1/assist/poll", {}, old.token)).body.session.id, session.id);

  now.value += 1_000;
  await server.connectionUi("pair", { code: "624193" });
  const replacement = await post("/v1/pair", { code: "624193", name: "新设备名", installationKey: key });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.deviceId, old.deviceId);
  assert.notEqual(replacement.body.token, old.token);
  assert.equal((await post("/v1/assist/poll", {}, old.token)).status, 401);
  assert.equal((await post("/v1/assist/poll", {}, other.token)).status, 200);
  assert.equal((await post("/v1/assist/poll", { installationKey: key }, replacement.body.token)).body.session, null);
  const after = await server.connectionUi("status");
  assert.equal(after.devices.length, 2);
  assert.equal(after.devices.find(device => device.id === old.deviceId).pairedAt, now.value);
  const stateJson = await fs.readFile(path.join(directory, "state.json"), "utf8");
  assert.ok(!stateJson.includes(key) && !stateJson.includes(replacement.body.token));
});

test("remote setup distinguishes same-name pairings and only marks a request reached by its phone", async t => {
  const { server, directory, now } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const firstAt = now.value;
  const first = await pairAssistPhone(server, post, "278341", "Same Phone");
  now.value += 2_000;
  const second = await pairAssistPhone(server, post, "184763", "Same Phone");
  assert.equal((await post("/v1/assist/poll", {}, second.token)).body.session, null);
  const status = await server.remoteUi("status");
  assert.deepEqual(status.devices, [
    { id: first.deviceId, name: "Same Phone", pairedAt: firstAt, lastRemoteContactAt: null },
    { id: second.deviceId, name: "Same Phone", pairedAt: now.value, lastRemoteContactAt: now.value },
  ]);
  const { session } = await server.remoteUi("request", { deviceId: first.deviceId, mode: "rainfall" });
  assert.equal(session.phoneContactAt, null);
  now.value += 1_000;
  assert.equal((await post("/v1/assist/poll", {}, second.token)).body.session, null);
  assert.equal((await server.remoteUi("status")).session.phoneContactAt, null);
  assert.equal((await post("/v1/assist/poll", {}, first.token)).body.session.id, session.id);
  assert.equal((await server.remoteUi("status")).session.phoneContactAt, now.value);
  await server.connectionUi("stop");
  assert.ok((await server.remoteUi("status")).devices.every(device => device.lastRemoteContactAt === null));
});

test("remote assistance requires handset consent and binds one-time input to one device and frame", async t => {
  const { server, directory } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const owner = await pairAssistPhone(server, post, "275918", "Phone A");
  const other = await pairAssistPhone(server, post, "692784", "Phone B");
  const start = await server.remoteUi("request", { deviceId: owner.deviceId, mode: "rainfall" });
  const { id } = start.session;
  const command = { seq: 1, kind: "tap", x: 0.5, y: 0.5 };
  assert.equal(start.session.phase, "pending");
  assert.equal((await post("/v1/assist/poll", {}, other.token)).body.session, null);
  assert.equal((await post("/v1/assist/poll", {}, owner.token)).body.session.id, id);
  assert.equal((await post("/v1/assist/frame", { id, seq: 1, jpeg: assistFrame }, owner.token)).body.session, null);
  await assert.rejects(server.remoteUi("input", { id, command }), /ASSIST_EXPIRED/);
  assert.equal((await post("/v1/assist/accept", { id, mode: "view" }, owner.token)).body.session, null);
  assert.equal((await post("/v1/assist/accept", { id, mode: "rainfall" }, other.token)).body.session, null);
  assert.equal((await post("/v1/assist/accept", { id, mode: "rainfall" }, owner.token)).body.session.phase, "active");
  assert.equal((await post("/v1/assist/frame", { id, seq: 1, jpeg: assistFrame }, other.token)).body.session, null);
  assert.equal((await post("/v1/assist/frame", { id, seq: 1, jpeg: "PHN2Zz4=" }, owner.token)).status, 400);
  const frame = seq => post("/v1/assist/frame", { id, seq, jpeg: assistFrame }, owner.token);
  assert.equal((await frame(1)).body.command, null);
  assert.deepEqual((await server.remoteUi("status")).session.frame, { seq: 1, jpeg: assistFrame });
  assert.equal((await server.remoteUi("status", { afterSeq: 1 })).session.frame, null);
  await server.remoteUi("input", { id, command });
  await assert.rejects(server.remoteUi("input", { id, command }), /ASSIST_INPUT_PENDING/);
  assert.equal((await frame(1)).body.command, null);
  assert.deepEqual((await frame(2)).body.command, command);
  assert.equal((await frame(3)).body.command, null);
  await assert.rejects(server.remoteUi("input", { id, command }), /ASSIST_FRAME_CHANGED/);
  assert.equal((await post("/v1/assist/stop", { id }, owner.token)).status, 200);
  assert.equal((await server.remoteUi("status")).session, null);
  assert.equal((await frame(4)).body.session, null);
});

test("view-only sharing rejects controls and ends after device unpair, network stop, or lost viewer", async t => {
  const { server, directory, now } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const { deviceId, token } = await pairAssistPhone(server, post, "517263", "Phone A");
  const begin = async () => {
    const { session } = await server.remoteUi("request", { deviceId, mode: "view" });
    await post("/v1/assist/accept", { id: session.id, mode: "view" }, token);
    await post("/v1/assist/frame", { id: session.id, seq: 1, jpeg: assistFrame }, token);
    return session.id;
  };
  const id = await begin();
  await assert.rejects(server.remoteUi("input", { id, command: { seq: 1, kind: "back" } }), /ASSIST_VIEW_ONLY/);
  now.value += 12_001;
  assert.equal((await post("/v1/assist/poll", {}, token)).body.session, null);
  await begin();
  now.value += 6_000;
  assert.ok((await server.remoteUi("status")).session);
  now.value += 6_001;
  assert.equal((await server.remoteUi("status")).session, null);
  await begin();
  await server.connectionUi("stop");
  assert.equal((await server.remoteUi("status")).session, null);
  await server.connectionUi("start", { address: loopback.address });
  await begin();
  await server.connectionUi("removeDevice", { id: deviceId });
  assert.equal((await server.remoteUi("status")).session, null);
  assert.equal((await post("/v1/assist/poll", {}, token)).status, 401);
});

test("viewer heartbeats cannot keep old consent or an outdated image alive", async t => {
  const { server, directory, now } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const { deviceId, token } = await pairAssistPhone(server, post, "718325", "Phone A");
  const { session: pending } = await server.remoteUi("request", { deviceId, mode: "rainfall" });
  while (now.value < pending.expiresAt) {
    now.value += 10_000;
    await server.remoteUi("status");
  }
  assert.equal((await post("/v1/assist/accept", { id: pending.id, mode: "rainfall" }, token)).body.session, null);
  const { session: next } = await server.remoteUi("request", { deviceId, mode: "rainfall" });
  const { body: { session: active } } = await post("/v1/assist/accept", { id: next.id, mode: "rainfall" }, token);
  await post("/v1/assist/frame", { id: active.id, seq: 1, jpeg: assistFrame }, token);
  now.value += 3_001;
  assert.equal((await server.remoteUi("status")).session.frame, null);
  await assert.rejects(server.remoteUi("input", { id: active.id, command: { seq: 1, kind: "back" } }), /ASSIST_FRAME_CHANGED/);
  assert.equal((await post("/v1/assist/poll", {}, token)).body.session.id, active.id);
  assert.deepEqual((await fs.readdir(directory)).sort(), ["identity.json", "state.json"]);
  while (now.value < active.expiresAt) {
    now.value += 10_000;
    await server.remoteUi("status");
    if (now.value < active.expiresAt) assert.equal((await post("/v1/assist/poll", {}, token)).body.session.id, active.id);
  }
  assert.equal((await post("/v1/assist/poll", {}, token)).body.session, null);
});

test("the receiver uses only an explicitly selected network interface", async t => {
  const { server, options } = await fixture(t);
  assert.equal((await server.connectionUi("status")).running, false);
  await assert.rejects(server.connectionUi("start", { address: "0.0.0.0" }), /ASSIST_INTERFACE_REQUIRED/);
  const interfaces = remoteAssistNetworkInterfaces({
    External: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
    Loopback: [{ ...loopback, family: "IPv4", internal: true }],
    WiFi: [{ address: "192.168.50.4", family: "IPv4", internal: false }],
    PrivateVPN: [{ address: "100.90.20.4", family: "IPv4", internal: false }],
  });
  assert.deepEqual(interfaces.map(item => item.address).sort(), ["100.90.20.4", "192.168.50.4"]);
  const started = await server.connectionUi("start", { address: loopback.address });
  assert.match(started.endpoint, /^https:\/\/127\.0\.0\.1:\d+\/#\w{64}$/u);
  assert.equal(await server.connectionUi("stop").then(snapshot => snapshot.endpoint), null);
  await server.connectionUi("start", { address: loopback.address });
  options.interfaces = () => [];
  assert.equal(await server.connectionUi("status").then(snapshot => snapshot.running), false);
});

test("the install link serves the checksum-matched APK on its own port until reception stops", async t => {
  const { server, options } = await fixture(t);
  const apk = Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.from("APK fixture bytes")]);
  const file = path.join(options.apkDirectory, "Rainfall-Remote-Assist.apk");
  await fs.mkdir(options.apkDirectory);
  await fs.writeFile(file, apk);
  await fs.writeFile(file + ".sha256", createHash("sha256").update(apk).digest("hex") + "  Rainfall-Remote-Assist.apk\n");

  assert.equal((await server.connectionUi("status")).apkDownloadUrl, null);
  const started = await server.connectionUi("start", { address: loopback.address });
  const download = new URL(started.apkDownloadUrl);
  assert.equal(download.protocol, "http:");
  assert.equal(download.hostname, loopback.address);
  assert.equal(download.pathname, "/Rainfall-Remote-Assist.apk");
  assert.notEqual(download.port, new URL(started.endpoint).port);
  const response = await fetch(download);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="Rainfall-Remote-Assist.apk"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), apk);
  assert.equal((await fetch(download, { method: "HEAD" })).headers.get("content-length"), String(apk.length));
  assert.equal((await fetch(new URL("/v1/pair", download))).status, 404);
  assert.equal((await fetch(download, { method: "POST" })).status, 405);

  assert.equal((await server.connectionUi("stop")).apkDownloadUrl, null);
  await assert.rejects(fetch(download));
  await fs.appendFile(file, "corrupted");
  const restarted = await server.connectionUi("start", { address: loopback.address });
  assert.equal(restarted.running, true);
  assert.equal(restarted.apkDownloadUrl, null);
});

test("previously paired phones keep their port and certificate without importing message history", async t => {
  const { server, directory, options, now } = await fixture(t);
  const legacyDirectory = path.join(directory, "legacy");
  options.legacyDirectory = legacyDirectory;
  const old = new RemoteAssistServer({ ...options, directory: legacyDirectory, legacyDirectory: undefined });
  t.after(() => old.close());
  const { endpoint } = await old.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, legacyDirectory);
  const first = await pairAssistPhone(old, post, "682149", "甲手机");
  const second = await pairAssistPhone(old, post, "915238", "乙手机");
  await old.close();

  const oldStateFile = path.join(legacyDirectory, "state.json");
  const legacyState = JSON.parse(await fs.readFile(oldStateFile, "utf8"));
  legacyState.notices = [{ id: randomUUID(), title: "历史记录" }];
  for (const device of legacyState.devices) device.lastSeenAt = now.value;
  const historicState = JSON.stringify(legacyState);
  await fs.writeFile(oldStateFile, historicState);
  const historicArrivalsFile = path.join(legacyDirectory, "arrivals.json");
  const historicArrivals = JSON.stringify([{ id: randomUUID() }]);
  await fs.writeFile(historicArrivalsFile, historicArrivals);

  const started = await server.connectionUi("start", { address: loopback.address });
  assert.equal(started.endpoint, endpoint);
  assert.deepEqual(started.devices.map(device => device.id), [first.deviceId, second.deviceId]);
  const newState = JSON.parse(await fs.readFile(path.join(directory, "state.json"), "utf8"));
  assert.deepEqual(Object.keys(newState).sort(), ["devices", "port", "version"]);
  assert.ok(newState.devices.every(device => !Object.hasOwn(device, "lastSeenAt")));
  assert.equal((await post("/v1/assist/poll", {}, first.token)).status, 200);
  await server.connectionUi("removeDevice", { id: first.deviceId });
  assert.equal((await post("/v1/assist/poll", {}, first.token)).status, 401);
  assert.equal((await post("/v1/unpair", {}, second.token)).status, 200);
  await server.close();

  const resumed = new RemoteAssistServer(options);
  t.after(() => resumed.close());
  assert.deepEqual((await resumed.connectionUi("status")).devices, []);
  assert.equal(await fs.readFile(oldStateFile, "utf8"), historicState);
  assert.equal(await fs.readFile(historicArrivalsFile, "utf8"), historicArrivals);
});

test("the phone transport rejects browser-origin requests and other routes", async t => {
  const { server, directory } = await fixture(t);
  const { endpoint } = await server.connectionUi("start", { address: loopback.address });
  const post = await phone(endpoint, directory);
  const { token } = await pairAssistPhone(server, post, "729061", "测试手机");
  assert.equal((await post("/v1/assist/poll", {}, token, { Origin: "https://example.invalid" })).status, 403);
  assert.equal((await post("/rpc", { channel: "rainfall:call" }, token)).status, 404);
});


test("pairing expires and locks after repeated guesses", async t => {
  const { server, directory, now } = await fixture(t);
  const post = await phone((await server.connectionUi("start", { address: loopback.address })).endpoint, directory);
  await server.connectionUi("pair", { code: "289314" });
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post("/v1/pair", { code: "000000", name: "错误配对" })).status, 401);
  }
  assert.equal((await post("/v1/pair", { code: "289314", name: "已锁定" })).status, 401);
  await server.connectionUi("pair", { code: "769235" });
  now.value += 300_001;
  assert.equal((await post("/v1/pair", { code: "769235", name: "已过期" })).status, 401);
  assert.equal((await server.connectionUi("status")).pairExpiresAt, null);
});
