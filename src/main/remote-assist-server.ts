import "reflect-metadata";
import { BasicConstraintsExtension, X509CertificateGenerator } from "@peculiar/x509";
import { createHash, createPrivateKey, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import { isIPv4, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { z } from "zod";
import { startRemoteAssistApkDownload } from "./remote-assist-apk";
import { assistFrameBodyLimit, RemoteAssist } from "./remote-assist";
import {
  remoteAssistDeviceNameSchema, remoteAssistPairCodeSchema,
  type RemoteAssistConnectionSnapshot, type RemoteAssistNetworkInterface, type RemoteAssistSnapshot,
} from "../shared/remote-assist";

const pairingMs = 5 * 60_000;
const maxBodyBytes = 2048;
const maxStoreBytes = 2 * 1024 * 1024;
const empty = z.strictObject({});
const identitySchema = z.strictObject({ cert: z.string().max(8192), key: z.string().max(8192) });
const installationKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional();
const deviceSchema = z.strictObject({
  id: z.uuid(), name: remoteAssistDeviceNameSchema, tokenHash: z.string().regex(/^[a-f0-9]{64}$/u),
  installationKeyHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  pairedAt: z.number().int(),
});
const storeSchema = z.strictObject({
  version: z.literal(1), port: z.number().int().min(1).max(65535).nullable(),
  devices: z.array(deviceSchema),
});
// An older installation shares this identity and device store with the retired module.
const legacyStoreSchema = z.object({ ...storeSchema.shape, devices: z.array(z.object(deviceSchema.shape)) });
const pairRequest = z.strictObject({ code: remoteAssistPairCodeSchema, name: remoteAssistDeviceNameSchema, installationKey });
const assistPollRequest = z.strictObject({ installationKey });
const startRequest = z.strictObject({ address: z.string().refine(isIPv4) });
const openPairRequest = z.strictObject({ code: remoteAssistPairCodeSchema });
const removeRequest = z.strictObject({ id: z.uuid() });
const assistRoutes = new Set(["/v1/assist/poll", "/v1/assist/accept", "/v1/assist/frame", "/v1/assist/stop"]);

type Store = z.infer<typeof storeSchema>;
type Device = z.infer<typeof deviceSchema>;
type Identity = z.infer<typeof identitySchema>;
type Listener = {
  server: Server;
  sockets: Set<Socket>;
  address: string;
  authority: string;
  endpoint: string;
  apk?: Awaited<ReturnType<typeof startRemoteAssistApkDownload>>;
};
type Pairing = { hash: Buffer; expiresAt: number; attempts: number };

export function remoteAssistNetworkInterfaces(interfaces = networkInterfaces()): RemoteAssistNetworkInterface[] {
  const choices = new Map<string, RemoteAssistNetworkInterface>();
  for (const [label, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4" || !isIPv4(entry.address)) continue;
      const [first, second] = entry.address.split(".").map(Number);
      const privateNetwork = first === 10 || (first === 192 && second === 168) ||
        (first === 172 && second >= 16 && second <= 31) || (first === 100 && second >= 64 && second <= 127);
      if (privateNetwork) choices.set(entry.address, { address: entry.address, label });
    }
  }
  return [...choices.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function readLocalJson<T>(file: string, schema: z.ZodType<T>): T | undefined {
  try {
    if (fs.statSync(file).size > maxStoreBytes) throw Error("File too large");
    return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw Error("ASSIST_STORE_UNAVAILABLE");
  }
}

function writeLocalJson(file: string, value: Store | Identity): void {
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > maxStoreBytes) throw Error("File too large");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, json, { flag: "wx", mode: 0o600, flush: true });
    fs.renameSync(temp, file);
  } catch {
    throw Error("ASSIST_STORE_UNAVAILABLE");
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch { /* Keep the original store error. */ }
  }
}

async function createIdentity(): Promise<Identity> {
  const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const now = Date.now();
  const cert = await X509CertificateGenerator.createSelfSigned({
    name: "CN=Rainfall Remote Assist", serialNumber: randomBytes(16).toString("hex"), keys,
    notBefore: new Date(now - 86_400_000), notAfter: new Date(now + 3650 * 86_400_000),
    signingAlgorithm: algorithm, extensions: [new BasicConstraintsExtension(false, undefined, true)],
  });
  const key = createPrivateKey({
    key: Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)), format: "der", type: "pkcs8",
  }).export({ format: "pem", type: "pkcs8" }).toString();
  return { cert: cert.toString("pem"), key };
}

class PhoneRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function readPhoneJson(request: IncomingMessage, bodyLimit = maxBodyBytes): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")) {
    throw new PhoneRequestError(415, "JSON_REQUIRED");
  }
  if (Number(request.headers["content-length"]) > bodyLimit) throw new PhoneRequestError(413, "REQUEST_TOO_LARGE");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) throw new PhoneRequestError(413, "REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PhoneRequestError(400, "INVALID_REQUEST"); }
}

function reply(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
  response.end(JSON.stringify(data));
}

async function closeListener(listener: Listener): Promise<void> {
  const closed = new Promise<void>(resolve => listener.server.close(() => resolve()));
  for (const socket of listener.sockets) socket.destroy();
  await Promise.all([closed, listener.apk?.close()]);
}

type RemoteAssistServerOptions = {
  directory: string;
  legacyDirectory?: string;
  apkDirectory?: string;
  interfaces?: () => RemoteAssistNetworkInterface[];
  now?: () => number;
  available?: () => boolean;
  protectKey?: (key: string) => string;
  openKey?: (protectedKey: string) => string;
};

export class RemoteAssistServer {
  private store?: Store;
  private listener?: Listener;
  private opening?: Promise<void>;
  private stopping?: Promise<void>;
  private epoch = 0;
  private pairing?: Pairing;
  private readonly assist = new RemoteAssist(() => this.time());

  constructor(private readonly options: RemoteAssistServerOptions) {}

  private time() { return this.options.now?.() ?? Date.now(); }
  private interfaces() { return this.options.interfaces?.() ?? remoteAssistNetworkInterfaces(); }
  private available() { return this.options.available?.() ?? true; }

  private get stateFile() { return path.join(this.options.directory, "state.json"); }

  private get state(): Store {
    const legacy = this.options.legacyDirectory;
    return this.store ??= readLocalJson(this.stateFile, storeSchema) ??
      (legacy ? readLocalJson(path.join(legacy, "state.json"), legacyStoreSchema) : undefined) ?? {
      version: 1, port: null, devices: [],
    };
  }

  private save(next: Store) {
    writeLocalJson(this.stateFile, next);
    this.store = next;
  }

  private activePairing() {
    if (this.pairing && this.pairing.expiresAt <= this.time()) this.pairing = undefined;
    return this.pairing;
  }

  private pairedDevices() { return this.state.devices.map(({ id, name, pairedAt }) => ({ id, name, pairedAt })); }

  private snapshot(): RemoteAssistConnectionSnapshot {
    return {
      running: Boolean(this.listener), interfaces: this.interfaces(), endpoint: this.listener?.endpoint ?? null,
      apkDownloadUrl: this.listener?.apk?.url ?? null,
      pairExpiresAt: this.activePairing()?.expiresAt ?? null,
      devices: this.pairedDevices(),
    };
  }

  async connectionUi(action: unknown, input: unknown = {}): Promise<RemoteAssistConnectionSnapshot> {
    if (!this.available()) throw Error("ASSIST_PRODUCTION_REQUIRED");
    switch (action) {
      case "status": {
        empty.parse(input);
        const address = this.listener?.address;
        if (address && !this.interfaces().some(entry => entry.address === address)) await this.close();
        break;
      }
      case "start": await this.start(startRequest.parse(input).address); break;
      case "stop": empty.parse(input); await this.close(); break;
      case "pair": {
        const { code } = openPairRequest.parse(input);
        if (!this.listener) throw Error("ASSIST_RECEIVER_REQUIRED");
        this.pairing = { hash: hash(code), expiresAt: this.time() + pairingMs, attempts: 0 };
        break;
      }
      case "cancelPairing": empty.parse(input); this.pairing = undefined; break;
      case "removeDevice": this.remove(removeRequest.parse(input).id); break;
      default: throw Error("INVALID_REQUEST");
    }
    return this.snapshot();
  }

  async remoteUi(action: unknown, input: unknown = {}): Promise<RemoteAssistSnapshot> {
    if (!this.available()) throw Error("ASSIST_PRODUCTION_REQUIRED");
    const address = this.listener?.address;
    if (address && !this.interfaces().some(entry => entry.address === address)) await this.close();
    return this.assist.ui(action, input, Boolean(this.listener), this.pairedDevices());
  }

  private remove(id: string) {
    const devices = this.state.devices.filter(device => device.id !== id);
    if (devices.length === this.state.devices.length) return;
    this.save({ ...this.state, devices });
    this.assist.dropConnection(id);
  }

  private async start(address: string): Promise<void> {
    if (this.opening || this.stopping) throw Error("ASSIST_RECEIVER_BUSY");
    if (this.listener?.address === address) return;
    if (this.listener) throw Error("ASSIST_RECEIVER_ALREADY_RUNNING");
    if (!this.interfaces().some(entry => entry.address === address)) throw Error("ASSIST_INTERFACE_REQUIRED");
    this.opening = this.open(address, this.epoch);
    try { await this.opening; } finally { this.opening = undefined; }
  }

  private async getIdentity() {
    const file = path.join(this.options.directory, "identity.json");
    const current = readLocalJson(file, identitySchema);
    const legacy = this.options.legacyDirectory;
    const saved = current ?? (legacy ? readLocalJson(path.join(legacy, "identity.json"), identitySchema) : undefined);
    if (saved && Date.parse(new X509Certificate(saved.cert).validTo) > this.time()) {
      const key = this.options.openKey?.(saved.key) ?? saved.key;
      if (!current) writeLocalJson(file, saved);
      return { cert: saved.cert, key };
    }
    const identity = await createIdentity();
    writeLocalJson(file, { cert: identity.cert, key: this.options.protectKey?.(identity.key) ?? identity.key });
    return identity;
  }

  private async open(address: string, epoch: number): Promise<void> {
    const identity = await this.getIdentity();
    if (epoch !== this.epoch || !this.available()) throw Error("ASSIST_RECEIVER_STOPPED");
    const server = createServer({ ...identity, minVersion: "TLSv1.2", maxHeaderSize: 4096, headersTimeout: 8_000,
      requestTimeout: 10_000, connectionsCheckingInterval: 1000 }, (request, response) => {
      void this.receive(listener, request, response);
    });
    const listener: Listener = { server, sockets: new Set(), address, authority: "", endpoint: "" };
    server.maxConnections = 32;
    server.setTimeout(10_000, socket => socket.destroy());
    server.on("connection", socket => {
      listener.sockets.add(socket);
      socket.once("close", () => listener.sockets.delete(socket));
    });
    const port = this.state.port ?? 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = () => reject(Error("ASSIST_PORT_UNAVAILABLE"));
        server.once("error", failed);
        server.listen(port, address, () => { server.off("error", failed); resolve(); });
      });
      server.on("error", () => { if (this.listener === listener) void this.close().catch(() => undefined); });
      if (epoch !== this.epoch || !this.available()) throw Error("ASSIST_RECEIVER_STOPPED");
      const bound = server.address();
      if (!bound || typeof bound === "string") throw Error("ASSIST_PORT_UNAVAILABLE");
      if (this.state.port !== bound.port || !fs.existsSync(this.stateFile)) this.save({ ...this.state, port: bound.port });
      listener.authority = `${address}:${bound.port}`;
      const pin = createHash("sha256").update(new X509Certificate(identity.cert).raw).digest("hex");
      listener.endpoint = `https://${listener.authority}/#${pin}`;
      if (this.options.apkDirectory) {
        listener.apk = await startRemoteAssistApkDownload(this.options.apkDirectory, address, () => this.listener === listener && this.available());
      }
      if (epoch !== this.epoch || !this.available()) throw Error("ASSIST_RECEIVER_STOPPED");
      this.listener = listener;
    } catch (error) {
      await closeListener(listener);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.epoch++;
    this.pairing = undefined;
    this.assist.dropConnection();
    const listener = this.listener;
    this.listener = undefined;
    const opening = this.opening;
    this.stopping = (async () => {
      if (listener) await closeListener(listener);
      if (opening) await opening.catch(() => undefined);
    })();
    try { await this.stopping; } finally { this.stopping = undefined; }
  }

  private authenticate(credential: string | undefined): Device {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(credential ?? "")?.[1];
    const tokenHash = token ? hash(token).toString("hex") : null;
    const device = tokenHash ? this.state.devices.find(entry => entry.tokenHash === tokenHash) : undefined;
    if (!device) throw new PhoneRequestError(401, "DEVICE_NOT_PAIRED");
    return device;
  }

  private pair(input: unknown) {
    const { code, name, installationKey } = pairRequest.parse(input);
    const active = this.activePairing();
    if (!active || !timingSafeEqual(active.hash, hash(code))) {
      if (active && ++active.attempts >= 5) this.pairing = undefined;
      throw new PhoneRequestError(401, "PAIR_CODE_REJECTED");
    }
    const token = randomBytes(32).toString("base64url"), time = this.time();
    const installationKeyHash = installationKey ? hash(installationKey).toString("hex") : undefined;
    const devices = this.state.devices;
    const previous = installationKeyHash ? devices.find(device => device.installationKeyHash === installationKeyHash) : undefined;
    const device: Device = { id: previous?.id ?? randomUUID(), name, tokenHash: hash(token).toString("hex"),
      installationKeyHash, pairedAt: time };
    this.save({ ...this.state, devices: previous ? devices.map(entry => entry.id === previous.id ? device : entry) : [...devices, device] });
    if (previous) this.assist.dropConnection(previous.id);
    this.pairing = undefined;
    return { ok: true, deviceId: device.id, token };
  }

  private registerInstallation(device: Device, input: unknown): void {
    const { installationKey } = assistPollRequest.parse(input);
    if (!installationKey) return;
    const installationKeyHash = hash(installationKey).toString("hex");
    if (device.installationKeyHash === installationKeyHash) return;
    if (device.installationKeyHash || this.state.devices.some(entry => entry.installationKeyHash === installationKeyHash)) {
      throw new PhoneRequestError(409, "INSTALLATION_ALREADY_PAIRED");
    }
    this.save({ ...this.state, devices: this.state.devices.map(entry => entry.id === device.id ? { ...entry, installationKeyHash } : entry) });
  }

  private async receive(listener: Listener, request: IncomingMessage, response: ServerResponse) {
    try {
      if (!this.available() || this.listener !== listener) throw new PhoneRequestError(503, "RECEIVER_UNAVAILABLE");
      if (request.headers.host !== listener.authority || request.headers.origin !== undefined) throw new PhoneRequestError(403, "SOURCE_REJECTED");
      const route = request.url ?? "";
      const assistance = assistRoutes.has(route);
      if (!assistance && route !== "/v1/pair" && route !== "/v1/unpair") throw new PhoneRequestError(404, "ROUTE_NOT_FOUND");
      if (request.method !== "POST") throw new PhoneRequestError(405, "METHOD_NOT_ALLOWED");
      if (assistance) this.authenticate(request.headers.authorization);
      const body = await readPhoneJson(request, route === "/v1/assist/frame" ? assistFrameBodyLimit : maxBodyBytes);
      if (!this.available() || this.listener !== listener) throw new PhoneRequestError(503, "RECEIVER_UNAVAILABLE");
      if (route === "/v1/pair") { reply(response, 200, this.pair(body)); return; }
      const device = this.authenticate(request.headers.authorization);
      if (route === "/v1/assist/poll") {
        this.registerInstallation(device, body);
        reply(response, 200, this.assist.phone(route, device.id, {}));
        return;
      }
      if (assistance) { reply(response, 200, this.assist.phone(route, device.id, body)); return; }
      empty.parse(body);
      this.remove(device.id);
      reply(response, 200, { ok: true });
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof PhoneRequestError) reply(response, error.status, { ok: false, code: error.code });
      else if (error instanceof z.ZodError) reply(response, 400, { ok: false, code: "INVALID_REQUEST" });
      else reply(response, 503, { ok: false, code: "RECEIVER_UNAVAILABLE" });
    }
  }
}
