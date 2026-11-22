import { z } from "zod";
import https from "node:https";
import dns from "node:dns";
import { isIP } from "node:net";
import { parseDraft, type CreativeDraft } from "../../shared/creation";
import { doubaoCoverEndpoint, zhipuCoverDownloadHosts, zhipuCoverEndpoint } from "../../shared/api-profiles";
import { imageCredentialCheckEndpoints } from "../../shared/platform-image";
import { planPuleHistoryMatch, puleCustomLyricsLimit, puleSubmissionText, withinPuleSubmissionWindow } from "../../shared/plan-pule";
import { puleDownloadRetryLimit, puleDownloadTimeoutMs } from "../../shared/pule-browser";
export type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  binary?: boolean;
  purpose?: "doubao_image" | "image_credential_check";
  signal?: AbortSignal;
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
  input.signal?.throwIfAborted();
  input.assertActive?.();
  const u = new URL(input.url);
  const imageCheck = input.purpose === "image_credential_check";
  const openAiImage = !imageCheck && u.hostname === "api.openai.com";
  const doubaoImage = input.purpose === "doubao_image";
  const zhipuImage = !imageCheck && u.hostname === "open.bigmodel.cn";
  const zhipuDownload = zhipuCoverDownloadHosts.some(host => host === u.hostname);
  if (
    u.protocol !== "https:" ||
    !["api.yourmusic.fun", "oss.yourmusic.fun", "api.deepseek.com", "ark.cn-beijing.volces.com", "api.openai.com", "open.bigmodel.cn", ...zhipuCoverDownloadHosts].includes(u.hostname) ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw Error("HTTP_HOST_REJECTED");
  if(u.hostname==='api.deepseek.com' && (u.search || u.hash || !((input.method==='GET' && u.pathname==='/models') || (input.method==='POST' && u.pathname==='/chat/completions'))))
    throw Error('HTTP_HOST_REJECTED');
  if (imageCheck && (input.method !== "GET" || input.body !== undefined || input.binary ||
      !Object.values(imageCredentialCheckEndpoints).some(endpoint => endpoint === u.href)))
    throw Error("HTTP_HOST_REJECTED");
  if(doubaoImage&&(u.href!==doubaoCoverEndpoint||input.method!=='POST'||input.binary))throw Error('HTTP_HOST_REJECTED');
  if(u.hostname==='ark.cn-beijing.volces.com'&&!doubaoImage&&!imageCheck&&(u.search||u.hash||input.method!=='POST'||u.pathname!=='/api/v3/chat/completions'))throw Error('HTTP_HOST_REJECTED');
  if(openAiImage&&(u.search||u.hash||input.method!=='POST'||input.binary||u.pathname!=='/v1/images/generations'))
    throw Error('HTTP_HOST_REJECTED');
  if(zhipuImage&&(u.href!==zhipuCoverEndpoint||input.method!=='POST'||input.binary))
    throw Error('HTTP_HOST_REJECTED');
  if(zhipuDownload&&(u.hash||input.method!=='GET'||!input.binary||input.body!==undefined))
    throw Error('HTTP_HOST_REJECTED');
  if (
    (u.hostname === "oss.yourmusic.fun" || zhipuDownload) &&
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
  input.signal?.throwIfAborted();
  input.assertActive?.();
  return new Promise((resolve, reject) => {
    const req = https.request(
      u,
      {
        method: input.method,
        headers: input.headers,
        signal: input.signal,
        lookup: ((_host: any, _options: any, callback: any) =>
          callback(null, [
            { address: addresses[0].address, family: 4 },
          ])) as any,
      },
      (res) => {
        const max = (zhipuDownload ? 8 : input.binary ? 50 : openAiImage || doubaoImage ? 12 : 2) * 1024 * 1024;
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
    // Keep the original generation request open for the upstream provider's receipt.
    const timeout = openAiImage ? 180000 : zhipuImage || doubaoImage ? 90000 :
      input.method==='POST'&&u.hostname==='api.yourmusic.fun'&&['/v1/suno/generate/prompt','/v1/suno/generate/custom'].includes(u.pathname)?120000:30000;
    if (!input.signal) req.setTimeout(timeout, () => req.destroy(Error("HTTP_TIMEOUT")));
    req.on("error", (cause: NodeJS.ErrnoException) => {
      const failure = Object.assign(Error(cause.message === "HTTP_TIMEOUT" ? "HTTP_TIMEOUT" : "HTTP_REQUEST_FAILED"), { code: cause.code });
      reject(failure);
    });
    if (input.body !== undefined) req.write(JSON.stringify(input.body));
    req.end();
  });
};

const retryableAudioFailures = new Set(["PULE_DOWNLOAD_TIMEOUT", "PULE_WAV_TRANSFER_FAILED", "HTTP_TIMEOUT", "HTTP_REQUEST_FAILED"]);
const retryableNetworkCodes = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ERR_STREAM_PREMATURE_CLOSE"]);

async function requestAudioDownload(request: HttpTransport, url: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = Error("PULE_DOWNLOAD_TIMEOUT");
      reject(error);
      controller.abort(error);
    }, puleDownloadTimeoutMs);
  });
  try {
    const response = await Promise.race([request({ method: "GET", url, binary: true, signal: controller.signal }), deadline]);
    if (response.status === 408 || response.status === 429 || (response.status >= 500 && response.status < 600))
      throw Error("PULE_WAV_TRANSFER_FAILED");
    return response;
  } finally { clearTimeout(timer); }
}

const SongSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["pending", "processing", "succeeded", "failed"]),
  audio_url: z.string().max(5000).nullish(),
  audio_delivery_status: z.string().max(100).nullish(),
  has_watermark: z.boolean().nullish(),
  image_url: z.string().max(5000).nullish(),
  title:z.string().max(1000).nullish(),duration:z.number().nonnegative().max(10000).nullish(),lyric:z.string().max(100000).nullish(),model_name:z.string().max(200).nullish(),created_at:z.string().max(200).nullish(),
});
const customReceiptSchema = z.object({
  task_id:z.string().min(1).max(200), status:z.enum(['pending','processing','succeeded']),
  songs:z.array(SongSchema.pick({id:true})).min(1).max(100),
});
const historySongSchema = SongSchema.pick({id:true,title:true,lyric:true,model_name:true,created_at:true})
  .extend({tags:z.string().max(4000).nullish(),instrumental:z.boolean().nullish()});
const historyPageSchema = z.object({data:z.array(z.unknown()).max(100),total:z.number().int().nonnegative().optional()});
const musicRejections:Record<number,Record<string,string>> = {
  400:{invalid_request_error:'MUSIC_REQUEST_REJECTED',content_safety_error:'MUSIC_CONTENT_REJECTED'},
  401:{authentication_error:'CREDENTIAL_REQUIRED'},
  403:{authentication_error:'MUSIC_PERMISSION_DENIED'},
  402:{insufficient_credits:'MUSIC_CREDITS_INSUFFICIENT'},
  429:{rate_limit_error:'MUSIC_RATE_LIMITED'},
};
const musicErrorSchema=z.object({error:z.object({type:z.enum([
  'invalid_request_error','content_safety_error','authentication_error','insufficient_credits','rate_limit_error',
])})});
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
  download(url: string, options?: { retry?: boolean }): Promise<{ bytes: Buffer; mime: string }>;
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
  }, assertDispatch?:()=>Promise<void>) {
    const d = parseDraft(input.draft),
      p = d.musicPrompts.yourmusic,
      lyrics = d.sections
        .map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
        .join("\n\n");
    if (["duet", "ensemble"].includes(p.voiceArrangement))
      throw Error("DUET_NOT_SUPPORTED");
    return this.submitCustom({
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
    }, assertDispatch);
  }
  async submitCustom(body: {
    title: string; lyrics: string; tags: string; negative_tags: string; model: string;
    instrumental: boolean; duration: number; is_max_mode: false; vocal_gender?: string;
  }, assertDispatch?:()=>Promise<void>) {
    if (!["chirp-v6", "chirp-v6-wild", "chirp-v6-mini"].includes(body.model))
      throw Error("MODEL_CAPABILITY_UNVERIFIED");
    if (Array.from(body.title).length > 80 || Array.from(body.lyrics).length > puleCustomLyricsLimit ||
      Array.from(body.tags).length > 1000 || Array.from(body.negative_tags).length > 1000 || body.duration > 360)
      throw Error("PROVIDER_LIMIT");
    let dispatched=false;
    try {
      const r = await this.api("POST", "/v1/suno/generate/custom", body, async()=>{
        await assertDispatch?.();
        dispatched=true;
      });
      if (r.status < 200 || r.status >= 300) {
        const rejected=musicErrorSchema.safeParse(r.body);
        const reason=rejected.success?musicRejections[r.status]?.[rejected.data.error.type]:undefined;
        return reason?{state:'failed' as const,reason,httpStatus:r.status}:
          {state:'unknown' as const,reason:'SUBMISSION_NOT_PROVEN_UNCHARGED',httpStatus:r.status};
      }
      // A submission receipt only needs the tracking ID and song IDs. Pending songs can have empty metadata.
      const parsed=customReceiptSchema.safeParse(r.body);
      if(!parsed.success)return {state:'unknown' as const,reason:'MUSIC_RECEIPT_INVALID',httpStatus:r.status};
      const ids = parsed.data.songs.map((s) => s.id);
      if (new Set(ids).size !== ids.length)
        return { state: "unknown", reason: "DUPLICATE_REMOTE_ID" };
      return {
        state: "accepted",
        trackingId: parsed.data.task_id,
        songIds: ids,
        actualCost: null,
        overrun: ids.length > 2,
      };
    } catch (error) {
      const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'MUSIC_REQUEST_FAILED';
      return {state:dispatched?'unknown':'failed',reason:reason==='HTTP_TIMEOUT'&&dispatched?'MUSIC_SUBMISSION_TIMEOUT':reason};
    }
  }
  async recoverCustom(input:{title:string;lyrics:string;tags:string;instrumental:boolean;model:string;createdAt:string}) {
    const matches=[];
    for(let page=1;page<=5;page++){
      const r=await this.api('GET',`/v1/music/generations/history?page=${page}&size=100`);
      if(r.status!==200)return {state:'unavailable' as const};
      const parsed=historyPageSchema.safeParse(r.body);
      if(!parsed.success)return {state:'unavailable' as const};
      const times=[];
      for(const raw of parsed.data.data){
        const entry=historySongSchema.safeParse(raw);
        if(!entry.success)continue;
        const song=entry.data;
        if(!song.created_at)continue;
        times.push(Date.parse(song.created_at));
        if(!withinPuleSubmissionWindow(input.createdAt,song.created_at)||song.title!==input.title||
          song.model_name!==input.model||song.instrumental!==input.instrumental||
          puleSubmissionText(song.lyric??'')!==puleSubmissionText(input.lyrics)||
          puleSubmissionText(song.tags??'')!==puleSubmissionText(input.tags))continue;
        matches.push({id:song.id,createdAt:song.created_at});
      }
      if(matches.length>2)return {state:'ambiguous' as const};
      if(parsed.data.data.length<100||(parsed.data.total!==undefined&&page*100>=parsed.data.total)||
        times.some(at=>at<Date.parse(input.createdAt)-5000))break;
      if(page===5)return {state:'unavailable' as const};
    }
    if(matches.length!==2)return {state:'not_found' as const};
    const verified=planPuleHistoryMatch.safeParse(matches);
    if(!verified.success)return {state:'ambiguous' as const};
    return {state:'found' as const,songs:verified.data.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))};
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
  async download(url: string, { retry = false } = {}) {
    safeMusicUrl(url);
    const retryLimit = retry ? puleDownloadRetryLimit : 0;
    let r: HttpResponse;
    for (let retries = 0; ; retries++) {
      try {
        r = await requestAudioDownload(this.options.request, url);
        break;
      } catch (error) {
        if (!(error instanceof Error) || (!retryableAudioFailures.has(error.message) &&
            !retryableNetworkCodes.has((error as NodeJS.ErrnoException).code ?? ""))) throw error;
        if (retries >= retryLimit) {
          if (error.message === "PULE_DOWNLOAD_TIMEOUT") throw error;
          throw Error("PULE_WAV_TRANSFER_FAILED", { cause: error });
        }
      }
    }
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
