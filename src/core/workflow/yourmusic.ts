import { z } from "zod";
import https from "node:https";
import dns from "node:dns";
import { isIP } from "node:net";
import { parseDraft, type CreativeDraft } from "../../shared/creation";
export type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  binary?: boolean;
};
export type HttpResponse = {
  status: number;
  body: any;
  headers?: Record<string, string>;
};
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;
export function safeMusicUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "oss.yourmusic.fun" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    u.hash
  )
    throw Error("DOWNLOAD_URL_REJECTED");
  return u;
}
export function publicIpv4(value: string) {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
// Optional real transport, never instantiated or registered by the current application.
// DNS resolves once; the connection is pinned to a public IPv4 address. No redirects/proxies.
export const nodeHttpsTransport: HttpTransport = async (input) => {
  const u = new URL(input.url);
  if (
    u.protocol !== "https:" ||
    !["api.yourmusic.fun", "oss.yourmusic.fun"].includes(u.hostname) ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw Error("HTTP_HOST_REJECTED");
  if (
    u.hostname === "oss.yourmusic.fun" &&
    input.headers &&
    Object.keys(input.headers).some((k) => k.toLowerCase() === "authorization")
  )
    throw Error("DOWNLOAD_AUTH_REJECTED");
  const addresses = await dns.promises.lookup(u.hostname, {
    family: 4,
    all: true,
  });
  if (!addresses.length || addresses.some((a) => !publicIpv4(a.address)))
    throw Error("HTTP_ADDRESS_REJECTED");
  return new Promise((resolve, reject) => {
    const req = https.request(
      u,
      {
        method: input.method,
        headers: input.headers,
        lookup: ((_host: any, _options: any, callback: any) =>
          callback(null, [
            { address: addresses[0].address, family: 4 },
          ])) as any,
      },
      (res) => {
        const max = input.binary ? 50 * 1024 * 1024 : 2 * 1024 * 1024;
        if (Number(res.headers["content-length"] ?? 0) > max) {
          res.destroy();
          reject(Error("HTTP_SIZE_LIMIT"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > max) {
            res.destroy(Error("HTTP_SIZE_LIMIT"));
          } else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const bytes = Buffer.concat(chunks);
            resolve({
              status: res.statusCode ?? 0,
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [
                  k,
                  String(v ?? ""),
                ]),
              ),
              body: input.binary ? bytes : JSON.parse(bytes.toString("utf8")),
            });
          } catch {
            reject(Error("HTTP_RESPONSE_INVALID"));
          }
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(Error("HTTP_TIMEOUT")));
    req.on("error", () => reject(Error("HTTP_REQUEST_FAILED")));
    if (input.body !== undefined) req.write(JSON.stringify(input.body));
    req.end();
  });
};
const SongSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["pending", "processing", "succeeded", "failed"]),
  audio_url: z.string().max(5000).optional(),
});
export interface MusicAdapter {
  source: "fixture" | "external";
  capabilities: {
    provider: string;
    version: string;
    maximumOutputs: number;
    lookupByClientKey: boolean;
    automaticPaid: boolean;
  };
  submit(input: {
    draft: CreativeDraft;
    modelId: string;
    operationId: string;
  }): Promise<any>;
  query(ids: string[]): Promise<any>;
  download(url: string): Promise<{ bytes: Buffer; mime: string }>;
}
export class YourMusicAdapter implements MusicAdapter {
  readonly source: "fixture" | "external";
  readonly capabilities = {
    provider: "yourmusic",
    version: "openapi-1.0.0",
    maximumOutputs: 2,
    lookupByClientKey: false,
    automaticPaid: false,
  };
  constructor(
    private options: {
      source: "fixture" | "external";
      request: HttpTransport;
      credential: () => Promise<string>;
    },
  ) {
    this.source = options.source;
  }
  private async api(method: "GET" | "POST", endpoint: string, body?: unknown) {
    const secret = await this.options.credential();
    return this.options.request({
      method,
      url: "https://api.yourmusic.fun" + endpoint,
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      ...(body ? { body } : {}),
    });
  }
  async submit(input: {
    draft: CreativeDraft;
    modelId: string;
    operationId: string;
  }) {
    const d = parseDraft(input.draft),
      p = d.musicPrompts.yourmusic,
      lyrics = d.sections
        .map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
        .join("\n\n");
    if (["duet", "ensemble"].includes(p.voiceArrangement))
      throw Error("DUET_NOT_SUPPORTED");
    if (!["chirp-v6", "chirp-v6-wild", "chirp-v6-mini"].includes(input.modelId))
      throw Error("MODEL_CAPABILITY_UNVERIFIED");
    if (
      Array.from(d.title).length > 80 ||
      Array.from(lyrics).length > 5000 ||
      Array.from(p.positiveStyle).length > 1000 ||
      Array.from(p.negativeStyle).length > 1000 ||
      p.durationTarget > 360
    )
      throw Error("PROVIDER_LIMIT");
    const body = {
      title: d.title,
      lyrics,
      tags: p.positiveStyle,
      negative_tags: p.negativeStyle,
      model: input.modelId,
      instrumental: d.instrumental,
      duration: p.durationTarget,
      is_max_mode: false,
      ...(["male", "female"].includes(p.voiceArrangement)
        ? { vocal_gender: p.voiceArrangement }
        : {}),
    };
    try {
      const r = await this.api("POST", "/v1/suno/generate/custom", body);
      if (r.status !== 202)
        return { state: "unknown", reason: "SUBMISSION_NOT_PROVEN_UNCHARGED" };
      const parsed = z
        .object({
          task_id: z.string().min(1),
          status: z.literal("pending"),
          songs: z.array(SongSchema).min(1).max(100),
        })
        .parse(r.body);
      const ids = parsed.songs.map((s) => s.id);
      if (new Set(ids).size !== ids.length)
        return { state: "unknown", reason: "DUPLICATE_REMOTE_ID" };
      return {
        state: "accepted",
        trackingId: parsed.task_id,
        songIds: ids,
        actualCost: null,
        overrun: ids.length > 2,
      };
    } catch {
      return { state: "unknown", reason: "SUBMISSION_OUTCOME_UNKNOWN" };
    }
  }
  async query(ids: string[]) {
    if (!ids.length || ids.some((id) => !id || id.length > 200))
      throw Error("SONG_IDS_REQUIRED");
    try {
      const r = await this.api(
        "GET",
        "/v1/music/generations/query?songid=" +
          encodeURIComponent(ids.join(",")),
      );
      if (r.status === 404)
        return { state: "pending", reason: "SONG_NOT_VISIBLE_OR_INCOMPLETE" };
      if (r.status !== 200) return { state: "error" };
      const songs = z.array(SongSchema).max(100).parse(r.body);
      if (
        songs.some((s) => !ids.includes(s.id)) ||
        new Set(songs.map((s) => s.id)).size !== songs.length
      )
        return { state: "error" };
      return { state: "known", songs };
    } catch {
      return { state: "error" };
    }
  }
  async download(url: string) {
    safeMusicUrl(url);
    const r = await this.options.request({ method: "GET", url, binary: true });
    const mime = (r.headers?.["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      r.status !== 200 ||
      ![
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/flac",
        "audio/ogg",
        "audio/mp4",
      ].includes(mime) ||
      !Buffer.isBuffer(r.body) ||
      !r.body.length ||
      r.body.length > 50 * 1024 * 1024
    )
      throw Error("DOWNLOAD_REJECTED");
    return { bytes: r.body, mime };
  }
}
