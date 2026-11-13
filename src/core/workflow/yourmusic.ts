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
  assertActive?:()=>void;
  assertDispatch?:()=>Promise<void>;
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
// Resolve once and pin the connection to a public IPv4 address. No redirects or proxies.
export const nodeHttpsTransport: HttpTransport = async (input) => {
  if(process.env.RAINFALL_OFFLINE_ACCEPTANCE==='1')throw Error('OFFLINE_ACCEPTANCE_NETWORK_DISABLED');
  input.assertActive?.();
  const u = new URL(input.url);
  const openAiImage = u.hostname === "api.openai.com";
  if (
    u.protocol !== "https:" ||
    !["api.yourmusic.fun", "oss.yourmusic.fun", "api.deepseek.com", "ark.cn-beijing.volces.com", "api.openai.com"].includes(u.hostname) ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw Error("HTTP_HOST_REJECTED");
  if(u.hostname==='api.deepseek.com' && (u.search || u.hash || !((input.method==='GET' && u.pathname==='/models') || (input.method==='POST' && u.pathname==='/chat/completions'))))
    throw Error('HTTP_HOST_REJECTED');
  if(u.hostname==='ark.cn-beijing.volces.com'&&(u.search||u.hash||input.method!=='POST'||u.pathname!=='/api/v3/chat/completions'))throw Error('HTTP_HOST_REJECTED');
  if(openAiImage&&(u.search||u.hash||input.method!=='POST'||input.binary||u.pathname!=='/v1/images/generations'))
    throw Error('HTTP_HOST_REJECTED');
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
  await input.assertDispatch?.();
  input.assertActive?.();
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
        const max = (input.binary ? 50 : openAiImage ? 12 : 2) * 1024 * 1024;
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
            let body: unknown = bytes;
            if (!input.binary) {
              try { body = JSON.parse(bytes.toString("utf8")); }
              catch { body = null; }
            }
            resolve({
              status: res.statusCode ?? 0,
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [
                  k,
                  String(v ?? ""),
                ]),
              ),
              body,
            });
          } catch {
            reject(Error("HTTP_RESPONSE_INVALID"));
          }
        });
      },
    );
    // Prompt mode first composes the lyrics. Keep the original request open.
    const timeout = openAiImage ? 180000 :
      input.method==='POST'&&u.hostname==='api.yourmusic.fun'&&u.pathname==='/v1/suno/generate/prompt'?120000:30000;
    req.setTimeout(timeout, () => req.destroy(Error("HTTP_TIMEOUT")));
    req.on("error", (cause: NodeJS.ErrnoException) => {
      const failure = Object.assign(Error(cause.message === "HTTP_TIMEOUT" ? "HTTP_TIMEOUT" : "HTTP_REQUEST_FAILED"), { code: cause.code });
      reject(failure);
    });
    if (input.body !== undefined) req.write(JSON.stringify(input.body));
    req.end();
  });
};
const SongSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["pending", "processing", "succeeded", "failed"]),
  audio_url: z.string().max(5000).optional(),
  audio_delivery_status: z.string().max(100).nullish(),
  has_watermark: z.boolean().nullish(),
  image_url: z.string().max(5000).nullish(),
  title:z.string().max(1000).optional(),duration:z.number().nonnegative().max(10000).optional(),lyric:z.string().max(100000).optional(),model_name:z.string().max(200).optional(),created_at:z.string().max(200).optional(),
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
  private async api(method: "GET" | "POST", endpoint: string, body?: unknown, assertDispatch?:()=>Promise<void>) {
    const secret = await this.options.credential();
    return this.options.request({
      method,
      url: "https://api.yourmusic.fun" + endpoint,
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      ...(body ? { body } : {}),
      assertDispatch,
    });
  }
  async submitPrompt(input:{prompt:string;modelId:string},assertDispatch:()=>Promise<void>){
    const prompt=input.prompt.trim();
    if(!prompt||Array.from(prompt).length>500)throw Error('PROVIDER_LIMIT');
    if(!['chirp-v6','chirp-v6-wild','chirp-v6-mini'].includes(input.modelId))throw Error('MODEL_CAPABILITY_UNVERIFIED');
    let dispatched=false;
    try{
      const response=await this.api('POST','/v1/suno/generate/prompt',{prompt,model:input.modelId,instrumental:false},async()=>{
        await assertDispatch();dispatched=true;
      });
      if(response.status<200||response.status>=300){
        const reasons:Record<number,string>={400:'MUSIC_PROMPT_REJECTED',401:'CREDENTIAL_REQUIRED',402:'MUSIC_CREDITS_INSUFFICIENT',429:'MUSIC_RATE_LIMITED'};
        const reason=reasons[response.status];
        return reason?{state:'failed' as const,reason}:{state:'unknown' as const,reason:'MUSIC_HTTP_'+response.status};
      }
      const receipt=z.object({task_id:z.string().min(1).max(200),status:z.enum(['pending','processing','succeeded']),
        songs:z.array(SongSchema.pick({id:true})).length(2)}).safeParse(response.body);
      if(!receipt.success)return {state:'unknown' as const,reason:'MUSIC_RECEIPT_INVALID_'+response.status};
      const songIds=receipt.data.songs.map(song=>song.id);
      if(new Set(songIds).size!==2)return {state:'unknown' as const,reason:'DUPLICATE_REMOTE_ID'};
      return {state:'accepted' as const,trackingId:receipt.data.task_id,songIds};
    }catch(error){
      const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'MUSIC_REQUEST_FAILED';
      return {state:dispatched?'unknown' as const:'failed' as const,reason};
    }
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
        return { state: "unknown", reason: "SUBMISSION_NOT_PROVEN_UNCHARGED",httpStatus:r.status };
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
      return { state: "known", songs:songs.map(s=>({...s,actualLyrics:s.lyric?{text:s.lyric,version:null}:null})) };
    } catch {
      return { state: "error" };
    }
  }
  async nativeWav(songId:string){
    z.string().uuid().parse(songId);
    const r=await this.api('POST','/v1/music/generations/wav',{songid:songId});
    if(r.status!==200)throw Error('NATIVE_WAV_NOT_AVAILABLE');
    const result=z.object({id:z.string(),audio_wav_url:z.string().url()}).parse(r.body);
    if(result.id!==songId)throw Error('OUTPUT_ID_MISMATCH');
    safeMusicUrl(result.audio_wav_url);return result;
  }
  async recoverRecent(input:{draft:CreativeDraft;createdAt:string;expectedModel?:string}){
    if(!input.expectedModel || !['chirp-v6','chirp-v6-wild','chirp-v6-mini'].includes(input.expectedModel))
      return {state:'not_established',reason:'EXPECTED_MODEL_REQUIRED'};
    if(!Number.isFinite(Date.parse(input.createdAt)))return {state:'not_established',reason:'DISPATCH_TIME_REQUIRED'};
    const r=await this.api('GET','/v1/music/generations/history?page=1&size=20');
    if(r.status!==200)return{state:'not_established',httpStatus:r.status};
    const page=z.object({data:z.array(SongSchema).max(20)}).safeParse(r.body);if(!page.success)return{state:'not_established'};
    const lyrics=input.draft.sections.map(s=>`[${s.kind}]\n${s.lines.join('\n')}`).join('\n\n');
    const start=Date.parse(input.createdAt),songs=page.data.data.filter(s=>s.title===input.draft.title&&s.model_name===input.expectedModel&&s.lyric===lyrics&&s.created_at&&Date.parse(s.created_at)>=start-5000&&Date.parse(s.created_at)<=start+300000);
    return songs.length===2&&new Set(songs.map(s=>s.id)).size===2?{state:'accepted',trackingId:null,songIds:songs.map(s=>s.id),evidence:'exact_title_lyrics_model_and_time_history_match'}:{state:'not_established',matchingCount:songs.length};
  }
  async download(url: string) {
    safeMusicUrl(url);
    const r = await this.options.request({ method: "GET", url, binary: true });
    let mime = (r.headers?.["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    // Official OSS serves MP3 and M4A results as generic binary. This is only a
    // format hint; Core still requires ffprobe to validate the entire audio.
    if(mime==='application/octet-stream'&&new URL(url).pathname.toLowerCase().endsWith('.mp3')&&Buffer.isBuffer(r.body)&&r.body.length>=10){
      const b=r.body,id3=b.subarray(0,3).toString('ascii')==='ID3'&&[2,3,4].includes(b[3])&&[6,7,8,9].every(i=>(b[i]&0x80)===0),frame=b[0]===0xff&&(b[1]&0xe0)===0xe0&&(b[1]&0x06)!==0&&(b[2]&0xf0)!==0&&(b[2]&0xf0)!==0xf0;
      if(id3||frame)mime='audio/mpeg';
    }
    if(mime==='application/octet-stream'&&new URL(url).pathname.toLowerCase().endsWith('.m4a')&&Buffer.isBuffer(r.body)&&r.body.length>=16){
      const b=r.body,size=b.readUInt32BE(0),brand=b.subarray(8,12).toString('ascii');
      if(size>=16&&size<=b.length&&b.subarray(4,8).toString('ascii')==='ftyp'&&['M4A ','isom','iso2','mp41','mp42'].includes(brand))mime='audio/mp4';
    }
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
