import { randomUUID } from "node:crypto";
import { z } from "zod";
import { remoteAssistCommandSchema, remoteAssistModeSchema, remoteAssistSeqSchema,
  type RemoteAssistCommand, type RemoteAssistDevice, type RemoteAssistFrame, type RemoteAssistPhoneSession, type RemoteAssistSnapshot,
} from "../shared/remote-assist";

const requestMs = 90_000;
const sessionMs = 300_000;
const connectionMs = 12_000;
const frameMs = 3_000;
const maxJpegChars = 360_000;
export const assistFrameBodyLimit = maxJpegChars + 256;
const mode = remoteAssistModeSchema;
const id = z.uuid();
const empty = z.strictObject({});
const status = z.strictObject({ afterSeq: remoteAssistSeqSchema.optional() });
const start = z.strictObject({ deviceId: id, mode });
const stop = z.strictObject({ id });
const accept = z.strictObject({ id, mode });
const control = z.strictObject({ id, command: remoteAssistCommandSchema });
const frame = z.strictObject({ id, seq: remoteAssistSeqSchema, jpeg: z.base64().max(maxJpegChars).refine(isBoundedJpeg) });

type Session = RemoteAssistPhoneSession & {
  deviceId: string;
  viewerUntil: number;
  phoneContactAt: number | null;
  previousSeq: number;
  frame: (RemoteAssistFrame & { at: number }) | null;
  command: RemoteAssistCommand | null;
};

function isBoundedJpeg(value: string): boolean {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 12 || bytes.readUInt16BE() !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + segmentLength + 2 >= bytes.length) return false;
    // Android's JPEG encoder emits the baseline frame marker. Bound dimensions before the viewer can decode.
    if (marker === 0xc0 && segmentLength >= 8) {
      const height = bytes.readUInt16BE(offset + 5), width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 && width <= 1600 && height <= 1600 && width * height <= 1_500_000;
    }
    if (marker === 0xda) return false;
    offset += segmentLength + 2;
  }
  return false;
}

function phoneSession(session: Session): RemoteAssistPhoneSession {
  const { id, mode, phase, expiresAt } = session;
  return { id, mode, phase, expiresAt };
}

export class RemoteAssist {
  private current?: Session;
  private sweep?: NodeJS.Timeout;
  private readonly deviceContacts = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  dropConnection(deviceId?: string): void {
    if (deviceId) this.deviceContacts.delete(deviceId);
    else this.deviceContacts.clear();
    if (!deviceId || this.current?.deviceId === deviceId) this.close();
  }

  private close(): void {
    this.current = undefined;
    clearInterval(this.sweep);
    this.sweep = undefined;
  }

  private session(): Session | undefined {
    const session = this.current;
    const now = this.now();
    if (!session) return undefined;
    const handsetLost = session.phase === "active" && session.phoneContactAt !== null && now - session.phoneContactAt >= connectionMs;
    if (now >= session.expiresAt || now >= session.viewerUntil || handsetLost) {
      this.close();
      return undefined;
    }
    if (session.frame && now - session.frame.at >= frameMs) {
      session.frame = null;
      session.command = null;
    }
    return session;
  }

  ui(action: unknown, input: unknown, running: boolean, devices: Array<Omit<RemoteAssistDevice, "lastRemoteContactAt">>): RemoteAssistSnapshot {
    const now = this.now();
    let session = this.session();
    let displayedFrame: RemoteAssistFrame | null = null;
    switch (action) {
      case "status": {
        const { afterSeq } = status.parse(input);
        if (session) session.viewerUntil = now + connectionMs;
        if (session?.frame && session.frame.seq !== afterSeq) {
          displayedFrame = { seq: session.frame.seq, jpeg: session.frame.jpeg };
        }
        break;
      }
      case "request": {
        const selection = start.parse(input);
        if (!running) throw Error("ASSIST_RECEIVER_REQUIRED");
        if (!devices.some(device => device.id === selection.deviceId)) throw Error("ASSIST_DEVICE_REQUIRED");
        if (session) throw Error("ASSIST_BUSY");
        session = this.current = { ...selection, id: randomUUID(), phase: "pending", expiresAt: now + requestMs,
          viewerUntil: now + connectionMs, phoneContactAt: null, previousSeq: 0, frame: null, command: null };
        this.sweep = setInterval(() => this.session(), 1_000).unref();
        break;
      }
      case "stop": {
        const request = stop.parse(input);
        if (session?.id === request.id) { this.close(); session = undefined; }
        break;
      }
      case "input": {
        const request = control.parse(input);
        if (session?.id !== request.id || session.phase !== "active") throw Error("ASSIST_EXPIRED");
        if (session.mode !== "rainfall") throw Error("ASSIST_VIEW_ONLY");
        if (!session.frame || session.frame.seq !== request.command.seq) throw Error("ASSIST_FRAME_CHANGED");
        if (session.command) throw Error("ASSIST_INPUT_PENDING");
        session.command = request.command;
        break;
      }
      default: throw Error("INVALID_REQUEST");
    }
    return {
      running,
      devices: devices.map(device => ({ ...device, lastRemoteContactAt: this.deviceContacts.get(device.id) ?? null })),
      session: session ? { ...phoneSession(session), deviceId: session.deviceId, frame: displayedFrame, phoneContactAt: session.phoneContactAt } : null,
    };
  }

  phone(route: string, deviceId: string, input: unknown): unknown {
    const current = this.session();
    const session = current?.deviceId === deviceId ? current : undefined;
    switch (route) {
      case "/v1/assist/poll": {
        empty.parse(input);
        const now = this.now();
        this.deviceContacts.set(deviceId, now);
        if (session) session.phoneContactAt = now;
        return { ok: true, session: session ? phoneSession(session) : null };
      }
      case "/v1/assist/accept": {
        const request = accept.parse(input);
        if (session?.id !== request.id || session.mode !== request.mode) return { ok: true, session: null };
        if (session.phase === "pending") {
          const now = this.now();
          session.phase = "active";
          session.expiresAt = now + sessionMs;
          session.phoneContactAt = now;
        }
        return { ok: true, session: phoneSession(session) };
      }
      case "/v1/assist/frame": {
        const { id, seq, jpeg } = frame.parse(input);
        if (session?.id !== id || session.phase !== "active") return { ok: true, session: null, command: null };
        if (seq <= session.previousSeq) return { ok: true, session: phoneSession(session), command: null };
        const command = seq === session.previousSeq + 1 ? session.command : null;
        const now = this.now();
        session.previousSeq = seq;
        session.phoneContactAt = now;
        session.frame = { seq, jpeg, at: now };
        session.command = null;
        return { ok: true, session: phoneSession(session), command };
      }
      case "/v1/assist/stop": {
        const request = stop.parse(input);
        if (session?.id === request.id) this.close();
        return { ok: true };
      }
      default: throw Error("INVALID_REQUEST");
    }
  }
}
