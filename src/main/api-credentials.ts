import {
  apiProfileSchema,
  canStoreApiCredential,
  credentialIdentitySchema,
  credentialInputSchema,
  credentialStatusInputSchema,
  doubaoCoverEndpoint,
  doubaoCoverSize,
  glmImageCoverModel,
  supportsImageApiModel,
  zhipuCoverDownloadHosts,
  zhipuCoverEndpoint,
  type ApiProfile,
  type CredentialStatus,
  type ApiConnectionCheck,
} from "../shared/api-profiles";
import type { CredentialVault } from "./credentials";
import { COVER_API_IMAGE_MAX_BYTES as maxCoverBytes, COVER_RESOLUTION_MIN } from "../shared/cover-handoff";
import {credentialFailureCode,credentialFailureMessages} from '../shared/credential-errors';
import { imageCredentialCheckEndpoints } from "../shared/platform-image";
import type { HttpTransport } from "../core/workflow/yourmusic";
import {YourMusicAdapter} from '../core/workflow/yourmusic';
import {DeepSeekAdapter} from '../core/workflow/deepseek';
import {ProviderTextAdapter} from '../core/workflow/provider-text';
import {z} from 'zod';
import {planMusicModelIds,planModelEvidenceTtlMs,type PlanModelEvidence} from '../shared/plan-models';

// Exact retained OpenApiHistoryResponseDto/OpenApiSongDto, bounded before projection.
// Never persist or return the song records, remote identifiers, titles or lyrics.
const musicHistorySchema=z.strictObject({
  data:z.array(z.strictObject({
    id:z.string().min(1).max(200),status:z.enum(['pending','processing','succeeded','failed']),
    title:z.string().max(1000).optional(),audio_url:z.string().max(5000).optional(),
    audio_wav_url:z.string().max(5000).optional(),image_url:z.string().max(5000).optional(),
    duration:z.number().finite().nonnegative().max(10000).optional(),lyric:z.string().max(100000).optional(),
    created_at:z.iso.datetime().optional(),instrumental:z.boolean().optional(),
    tags:z.string().max(10000).optional(),model_name:z.string().min(1).max(200).optional(),
  })).max(20),
  total:z.number().int().nonnegative(),page:z.literal(1),size:z.literal(20),total_pages:z.number().int().nonnegative(),
}).refine(p=>p.total>=p.data.length&&p.total_pages===Math.ceil(p.total/20));

type Context = { mode: string; generation: number };
const imageCredentialIdentitySchema = credentialIdentitySchema.extend({ modelId: z.string().min(1).max(200).optional() });
const connectionCheckEndpoints = {
  deepseek: "https://api.deepseek.com/models",
  yourmusic: "https://api.yourmusic.fun/v1/music/generations/history?page=1&size=1",
  ...imageCredentialCheckEndpoints,
};

function maskApiKey(secret: string) {
  const characters = Array.from(secret);
  if (characters.length <= 6) return "*".repeat(characters.length);
  return characters.slice(0, 2).join("") + "*".repeat(characters.length - 6) + characters.slice(-4).join("");
}

function matchesConnectionResponse(providerId: ApiConnectionCheck["providerId"], body: any) {
  if (!Array.isArray(body?.data)) return false;
  if (providerId === "yourmusic") {
    return body.data.length <= 1 && Number.isInteger(body.total) && body.total >= 0 &&
      body.page === 1 && body.size === 1 && Number.isInteger(body.total_pages) && body.total_pages >= 0;
  }
  if (body.object !== "list" || (providerId === "deepseek" && body.data.length > 100) ||
      (providerId === "zhipu_image" && body.data.length > 1)) return false;
  return body.data.every((item: any) => typeof item?.id === "string" && item.id.trim().length > 0 && item.id.length < 200);
}

function zhipuDownloadUrl(raw: unknown) {
  const url = typeof raw === 'string' && raw.length <= 4096 ? URL.parse(raw) : null;
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !zhipuCoverDownloadHosts.some(host => host === url.hostname))
    throw Error('IMAGE_DOWNLOAD_URL_REJECTED');
  return url.href;
}

type Options = {
  vault: CredentialVault;
  getProfile: (id: string) => Promise<ApiProfile | undefined>;
  context: () => Context;
  connectionRequest?: HttpTransport;
  textRequest?: HttpTransport;
  // Main-only cache owner. Await before mutating music credentials; failure blocks mutation.
  invalidateMusicModelEvidence?: (identity:{profileId:string;expectedRevision:number})=>Promise<void>;
};
function connectionFailure(error: unknown): NonNullable<ApiConnectionCheck["failureCode"]> {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "HTTP_DNS_FAILED";
  if (["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_")) return "HTTP_TLS_FAILED";
  if (["ERR_INVALID_CHAR", "ERR_HTTP_INVALID_HEADER_VALUE"].includes(code)) return "CREDENTIAL_FORMAT_INVALID";
  if (["EACCES", "EPERM"].includes(code)) return "HTTP_ACCESS_DENIED";
  if (e?.message === "HTTP_ADDRESS_REJECTED") return "HTTP_ADDRESS_REJECTED";
  if (e?.message === "HTTP_TIMEOUT") return "HTTP_TIMEOUT";
  if (e?.message === "HTTP_SIZE_LIMIT") return "HTTP_SIZE_LIMIT";
  return "HTTP_REQUEST_FAILED";
}
export class ApiCredentials {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private options: Options) {}
  // Shared with profile writes, mode changes and restore in Main.
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const scope = { ...this.options.context() };
    const result = this.tail.then(() => {
      this.assertScope(scope);
      return fn();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  private assertScope(scope: Context) {
    const current = this.options.context();
    if (scope.mode !== current.mode || scope.generation !== current.generation)
      throw Error("WORKSPACE_CHANGED");
  }
  private async lookup(id: string, scope: Context, revision?: number) {
    const raw = await this.options.getProfile(id);
    this.assertScope(scope);
    if (!raw) throw Error("PROFILE_NOT_FOUND");
    const profile = apiProfileSchema.parse(raw);
    if (profile.id !== id) throw Error("CREDENTIAL_IDENTITY_MISMATCH");
    if (revision !== undefined && profile.revision !== revision)
      throw Error("REVISION_CONFLICT");
    return profile;
  }
  private binding(profile: ApiProfile) {
    return {
      accountId: profile.id,
      providerId: profile.providerId,
      remoteSubject: "local-profile:" + profile.id,
    };
  }
  private status(profile: ApiProfile, includeMaskedKey = false): CredentialStatus {
    const absent: CredentialStatus = {
      profileId: profile.id,
      state: "absent",
      configured: false,
    };
    if (!canStoreApiCredential(profile)) return absent;
    try {
      if (!this.options.vault.isAvailable())
        return { ...absent, state: "unavailable", failureCode:'SECURE_STORAGE_UNAVAILABLE' };
      const binding = this.binding(profile);
      if (!this.options.vault.has(binding)) return absent;
      const status: CredentialStatus = { ...absent, state: "stored_unverified", configured: true };
      if (includeMaskedKey && profile.kind === "image") status.maskedKey = maskApiKey(this.options.vault.get(binding));
      return status;
    } catch (error) {
      return { ...absent, state: "unavailable", failureCode:credentialFailureCode(error) };
    }
  }
  async apiCredentialStatus(input: unknown): Promise<CredentialStatus> {
    const { profileId, includeMaskedKey } = credentialStatusInputSchema.parse(input);
    const scope = { ...this.options.context() };
    if (scope.mode !== "production")
      return { profileId, state: "unavailable", configured: false };
    return this.runExclusive(async () => {
      return this.status(await this.lookup(profileId, scope), includeMaskedKey);
    });
  }
  async writeApiCredential(input: unknown): Promise<CredentialStatus> {
    const { profileId, expectedRevision, secret } =
      credentialInputSchema.parse(input);
    const scope = { ...this.options.context() };
    if (scope.mode !== "production")
      throw Error(
        scope.mode === "simulation"
          ? "SIMULATION_CREDENTIALS_DISABLED"
          : "WORKSPACE_CHANGED",
      );
    return this.runExclusive(async () => {
      const profile = await this.lookup(profileId, scope, expectedRevision);
      if (!canStoreApiCredential(profile))
        throw Error("PROVIDER_NOT_CONFIGURED");
      if(profile.providerId==='yourmusic'&&profile.kind==='music'&&this.options.invalidateMusicModelEvidence){
        await this.options.invalidateMusicModelEvidence({profileId,expectedRevision});
        await this.lookup(profileId,scope,expectedRevision);
      }
      this.options.vault.put(this.binding(profile), secret);
      await this.lookup(profileId, scope, expectedRevision);
      const saved=this.status(profile, true);
      if(!saved.configured)throw Error(saved.failureCode??'CREDENTIAL_READBACK_FAILED');
      return saved;
    });
  }
  async clearApiCredential(input: unknown): Promise<CredentialStatus> {
    const { profileId, expectedRevision } =
      credentialIdentitySchema.parse(input);
    const scope = { ...this.options.context() };
    if (scope.mode !== "production")
      throw Error(
        scope.mode === "simulation"
          ? "SIMULATION_CREDENTIALS_DISABLED"
          : "WORKSPACE_CHANGED",
      );
    return this.runExclusive(async () => {
      const profile = await this.lookup(profileId, scope, expectedRevision);
      if (!canStoreApiCredential(profile))
        throw Error("PROVIDER_NOT_CONFIGURED");
      if(profile.providerId==='yourmusic'&&profile.kind==='music'&&this.options.invalidateMusicModelEvidence){
        await this.options.invalidateMusicModelEvidence({profileId,expectedRevision});
        await this.lookup(profileId,scope,expectedRevision);
      }
      this.options.vault.delete(this.binding(profile));
      await this.lookup(profileId, scope, expectedRevision);
      return this.status(profile);
    });
  }
  async checkApiConnection(input: unknown): Promise<ApiConnectionCheck> {
    const { profileId, expectedRevision } = credentialIdentitySchema.parse(input);
    const scope = { ...this.options.context() };
    if (scope.mode !== "production")
      throw Error(scope.mode === "simulation" ? "SIMULATION_CREDENTIALS_DISABLED" : "WORKSPACE_CHANGED");
    return this.runExclusive(async () => {
      const profile = await this.lookup(profileId, scope, expectedRevision);
      if (!Object.hasOwn(connectionCheckEndpoints, profile.providerId)) throw Error("CONNECTION_CHECK_UNSUPPORTED");
      const providerId = profile.providerId as keyof typeof connectionCheckEndpoints;
      const request = providerId === "deepseek" ? this.options.textRequest : this.options.connectionRequest;
      if (!request) throw Error("CONNECTION_CHECK_UNAVAILABLE");
      // Only Main consumes the credential. Never return request, headers, history or remote errors.
      const credential = this.options.vault.get(this.binding(profile));
      let failureCode: ApiConnectionCheck["failureCode"] = null;
      const response = await request({
        method: "GET",
        url: connectionCheckEndpoints[providerId],
        ...(profile.kind === "image" ? { purpose: "image_credential_check" } : {}),
        headers: { Authorization: "Bearer " + credential, Accept: "application/json" },
        assertActive: () => this.assertScope(scope),
      }).catch(error => { failureCode = connectionFailure(error); return null; });
      await this.lookup(profileId, scope, expectedRevision);
      let state: ApiConnectionCheck["state"] = "unavailable";
      const status = response?.status ?? null;
      if (status === 200) {
        state = matchesConnectionResponse(providerId, response?.body) ? "connected" : "invalid_response";
      } else if (status === 401) state = "unauthorized";
      else if (status === 403) state = "forbidden";
      else if (status === 402) state = "credits_required";
      else if (status === 429) state = "rate_limited";
      return { profileId, providerId, state, httpStatus: status, failureCode,
        checkedAt: new Date().toISOString(), scope: "authentication_only", paidGenerationRequested: false };
    });
  }
  async readMusicModelEvidence(input:unknown):Promise<PlanModelEvidence>{
    return this.withMusicModelEvidence(input,async evidence=>evidence);
  }
  // Main keeps the read and its cache commit under the same lock as key replacement/clear.
  // Only the safe projection crosses the callback, never the adapter, credential or history.
  async withMusicModelEvidence<T>(input:unknown,callback:(evidence:PlanModelEvidence)=>Promise<T>):Promise<T>{
    const {profileId,expectedRevision}=credentialIdentitySchema.parse(input),scope={...this.options.context()};
    if(scope.mode!=='production')throw Error(scope.mode==='simulation'?'SIMULATION_CREDENTIALS_DISABLED':'WORKSPACE_CHANGED');
    return this.runExclusive(async()=>{
      const profile=await this.lookup(profileId,scope,expectedRevision);
      if(profile.providerId!=='yourmusic'||profile.kind!=='music')throw Error('PROVIDER_NOT_CONFIGURED');
      const request=this.options.connectionRequest;if(!request)throw Error('CONNECTION_CHECK_UNAVAILABLE');
      const status=this.status(profile);
      if(status.state==='unavailable')throw Error('SECURE_STORAGE_UNAVAILABLE');
      if(!status.configured)throw Error('CREDENTIAL_NOT_CONFIGURED');
      const credential=this.options.vault.get(this.binding(profile));
      const response=await request({method:'GET',url:'https://api.yourmusic.fun/v1/music/generations/history?page=1&size=20',
        headers:{Authorization:'Bearer '+credential,Accept:'application/json'},assertActive:()=>this.assertScope(scope),
      }).catch(()=>null);
      await this.lookup(profileId,scope,expectedRevision);
      if(!response||response.status!==200)throw Error('MODEL_EVIDENCE_READ_FAILED');
      const parsed=musicHistorySchema.safeParse(response.body);
      if(!parsed.success)throw Error('MODEL_EVIDENCE_INVALID_RESPONSE');
      const observedAt=new Date().toISOString();
      const evidence:PlanModelEvidence={profileId,profileRevision:profile.revision,providerId:'yourmusic',source:'yourmusic_history',
        scope:'historical_success_only',range:{page:1,size:20},observedAt,expiresAt:new Date(Date.parse(observedAt)+planModelEvidenceTtlMs).toISOString(),
        models:planMusicModelIds.filter(modelId=>parsed.data.data.some(song=>song.status==='succeeded'&&song.model_name===modelId))
          .map(modelId=>({modelId,status:'account-observed-success' as const})),
      };
      const result=await callback(evidence);
      await this.lookup(profileId,scope,expectedRevision);
      return result;
    });
  }
  async withMusicAdapter<T>(input:unknown,callback:(adapter:YourMusicAdapter)=>Promise<T>,assertActive:()=>void=()=>{}):Promise<T>{
    assertActive();
    const {profileId,expectedRevision}=credentialIdentitySchema.parse(input),scope={...this.options.context()};
    if(scope.mode!=='production')throw Error('PRODUCTION_REQUIRED');
    return this.runExclusive(async()=>{
      assertActive();
      const profile=await this.lookup(profileId,scope,expectedRevision);
      if(profile.providerId!=='yourmusic'||profile.kind!=='music')throw Error('PROVIDER_NOT_CONFIGURED');
      const request=this.options.connectionRequest;if(!request)throw Error('CONNECTION_CHECK_UNAVAILABLE');
      const guard=()=>{assertActive();this.assertScope(scope)};
      const adapter=new YourMusicAdapter({source:'external',request:input=>{guard();return request({...input,assertActive:guard})},credential:async()=>{guard();return this.options.vault.get(this.binding(profile))}});
      const result=await callback(adapter);this.assertScope(scope);return result;
    });
  }
  async withProviderTextAdapter<T>(input:unknown,callback:(adapter:ProviderTextAdapter)=>Promise<T>,assertActive:()=>void=()=>{}):Promise<T>{
    assertActive();const {profileId,expectedRevision}=credentialIdentitySchema.parse(input),scope={...this.options.context()};
    if(scope.mode!=='production')throw Error('PRODUCTION_REQUIRED');
    return this.runExclusive(async()=>{
      const profile=await this.lookup(profileId,scope,expectedRevision);
      if(profile.kind!=='text'||!['deepseek','doubao'].includes(profile.providerId)||!profile.modelId||!profile.textPricing)throw Error('TEXT_PROFILE_OR_PRICE_REQUIRED');
      if(!this.status(profile).configured)throw Error('CREDENTIAL_REQUIRED');
      const request=this.options.textRequest;if(!request)throw Error('TEXT_TRANSPORT_UNAVAILABLE');
      const guard=()=>{assertActive();this.assertScope(scope)};
      const adapter=new ProviderTextAdapter({providerId:profile.providerId as 'deepseek'|'doubao',profileId,profileRevision:expectedRevision,modelId:profile.modelId,
        request:input=>{guard();return request({...input,assertActive:guard})},assertActive:guard,credential:async()=>{guard();return this.options.vault.get(this.binding(profile))}});
      const result=await callback(adapter);guard();return result;
    });
  }
  async generatePlanCover(input:unknown,prompt:string,beforeSend:()=>Promise<void>,assertActive:()=>void,coverResolution?:number) {
    const {profileId,expectedRevision,modelId}=imageCredentialIdentitySchema.parse(input),scope={...this.options.context()};
    if(scope.mode!=='production')throw Error('PRODUCTION_REQUIRED');
    return this.runExclusive(async()=>{
      assertActive();
      const profile=await this.lookup(profileId,scope,expectedRevision);
      const model=modelId??profile.modelId;
      if(profile.kind!=='image'||!supportsImageApiModel(profile.providerId,model))
        throw Error('IMAGE_PROFILE_REQUIRED');
      const request=this.options.connectionRequest;
      if(!request)throw Error('IMAGE_TRANSPORT_UNAVAILABLE');
      const credential=this.options.vault.get(this.binding(profile));
      const guard=()=>{assertActive();this.assertScope(scope);};
      const zhipu=profile.providerId==='zhipu_image';
      const doubao=profile.providerId==='doubao_image';
      const glmImage=model===glmImageCoverModel;
      const nativeSize=coverResolution!==undefined&&coverResolution>=COVER_RESOLUTION_MIN&&
        (glmImage?coverResolution%32===0&&coverResolution<=2048:coverResolution%16===0&&coverResolution**2<=2**21);
      const zhipuSize=nativeSize?`${coverResolution}x${coverResolution}`:glmImage?'1280x1280':'1024x1024';
      const imagePrompt=glmImage?Array.from(prompt).slice(0,1000).join(''):prompt.slice(0,24000);
      const imageRequest = doubao ? {
        url:doubaoCoverEndpoint, purpose:'doubao_image' as const,
        body:{model,prompt:imagePrompt,size:doubaoCoverSize,response_format:'b64_json',output_format:'jpeg'},
      } : zhipu ? {
        url:zhipuCoverEndpoint, body:{model,prompt:imagePrompt,size:zhipuSize},
      } : {
        url:'https://api.openai.com/v1/images/generations',
        body:{model,prompt:imagePrompt,size:'2048x2048',quality:'medium',n:1,output_format:'jpeg'},
      };
      const response=await request({
        ...imageRequest, method:'POST',
        headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json',Accept:'application/json'},
        assertActive:guard,assertDispatch:beforeSend,
      });
      guard();
      if(response.status>=400&&response.status<500){
        const code=zhipu&&response.status===400?response.body?.error?.code:undefined;
        const cause=(typeof code==='string'||typeof code==='number')&&/^\d{4}$/u.test(String(code))?String(code):undefined;
        throw Error('IMAGE_HTTP_'+response.status,cause?{cause}:undefined);
      }
      if(response.status!==200)throw Error('IMAGE_OUTCOME_UNKNOWN');
      const results=response.body?.data;
      if(zhipu){
        const url=zhipuDownloadUrl(Array.isArray(results)&&results.length===1?results[0]?.url:undefined);
        const image=await request({method:'GET',url,binary:true,assertActive:guard});
        guard();
        if(image.status!==200)throw Error('IMAGE_DOWNLOAD_FAILED');
        const bytes=image.body;
        if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>maxCoverBytes)throw Error('IMAGE_RESPONSE_INVALID');
        const isPng=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
        const isJpeg=bytes[0]===0xff&&bytes[1]===0xd8;
        const isWebP=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
        if(!isPng&&!isJpeg&&!isWebP)throw Error('IMAGE_RESPONSE_INVALID');
        return bytes;
      }
      const image=Array.isArray(results)&&results.length===1?results[0]:undefined;
      if(doubao&&(response.body?.model!==model||image?.size!==doubaoCoverSize))throw Error('IMAGE_RESPONSE_INVALID');
      const encoded=image?.b64_json;
      if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(maxCoverBytes/3)*4||encoded.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw Error('IMAGE_RESPONSE_INVALID');
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.length>maxCoverBytes||bytes[0]!==0xff||bytes[1]!==0xd8)throw Error('IMAGE_RESPONSE_INVALID');
      return bytes;
    });
  }
  async withDeepSeekAdapter<T>(input:unknown,callback:(adapter:DeepSeekAdapter)=>Promise<T>,assertActive:()=>void=()=>{}):Promise<T>{
    assertActive();
    const {profileId,expectedRevision}=credentialIdentitySchema.parse(input),scope={...this.options.context()};
    if(scope.mode!=='production')throw Error('PRODUCTION_REQUIRED');
    return this.runExclusive(async()=>{
      assertActive();const profile=await this.lookup(profileId,scope,expectedRevision);
      if(profile.providerId!=='deepseek'||profile.kind!=='text')throw Error('PROVIDER_NOT_CONFIGURED');
      const request=this.options.textRequest;if(!request)throw Error('CONNECTION_CHECK_UNAVAILABLE');
      const guard=()=>{assertActive();this.assertScope(scope)};
      const adapter=new DeepSeekAdapter({request:input=>{guard();return request({...input,assertActive:guard})},credential:async()=>{guard();return this.options.vault.get(this.binding(profile))}});
      const result=await callback(adapter);guard();return result;
    });
  }
}

const publicErrors = new Set([
  ...Object.keys(credentialFailureMessages),
  "IPC_SOURCE_REJECTED",
  "WORKSPACE_CHANGED",
  "PROFILE_NOT_FOUND",
  "REVISION_CONFLICT",
  "PROVIDER_NOT_CONFIGURED",
  "SIMULATION_CREDENTIALS_DISABLED",
  "SECURE_STORAGE_UNAVAILABLE",
  "CONNECTION_CHECK_UNSUPPORTED",
  "CONNECTION_CHECK_UNAVAILABLE",
]);
export function registerApiCredentialHandlers(
  register: (
    channel: string,
    handler: (event: any, input: unknown) => Promise<any>,
  ) => void,
  trusted: (event: any) => void,
  service: ApiCredentials,
) {
  for (const [name, action] of [
    ["write", (input: unknown) => service.writeApiCredential(input)],
    ["clear", (input: unknown) => service.clearApiCredential(input)],
    ["status", (input: unknown) => service.apiCredentialStatus(input)],
    ["check", (input: unknown) => service.checkApiConnection(input)],
  ] as const) {
    register("rainfall:api-credential:" + name, async (event, input) => {
      try {
        trusted(event);
        return { ok: true, value: await action(input) };
      } catch (e) {
        const code =
          e instanceof Error && publicErrors.has(e.message)
            ? e.message
            : "CREDENTIAL_REQUEST_REJECTED";
        return {
          ok: false,
          error: { code, message: "凭据操作未完成，请检查配置与安全存储。" },
        };
      }
    });
  }
}
