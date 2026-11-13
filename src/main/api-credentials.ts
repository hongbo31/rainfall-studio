import {
  apiProfileSchema,
  canStoreApiCredential,
  credentialIdentitySchema,
  credentialInputSchema,
  credentialStatusInputSchema,
  openAiCoverModel,
  type ApiProfile,
  type CredentialStatus,
  type ApiConnectionCheck,
} from "../shared/api-profiles";
import type { CredentialVault } from "./credentials";
import {credentialFailureCode,credentialFailureMessages} from '../shared/credential-errors';
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
  private status(profile: ApiProfile): CredentialStatus {
    const absent: CredentialStatus = {
      profileId: profile.id,
      state: "absent",
      configured: false,
    };
    if (!canStoreApiCredential(profile)) return absent;
    try {
      if (!this.options.vault.isAvailable())
        return { ...absent, state: "unavailable", failureCode:'SECURE_STORAGE_UNAVAILABLE' };
      return this.options.vault.has(this.binding(profile))
        ? { ...absent, state: "stored_unverified", configured: true }
        : absent;
    } catch (error) {
      return { ...absent, state: "unavailable", failureCode:credentialFailureCode(error) };
    }
  }
  async apiCredentialStatus(input: unknown): Promise<CredentialStatus> {
    const { profileId } = credentialStatusInputSchema.parse(input);
    const scope = { ...this.options.context() };
    if (scope.mode !== "production")
      return { profileId, state: "unavailable", configured: false };
    return this.runExclusive(async () => {
      return this.status(await this.lookup(profileId, scope));
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
      const saved=this.status(profile);
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
      if (!["yourmusic", "deepseek"].includes(profile.providerId)) throw Error("CONNECTION_CHECK_UNSUPPORTED");
      const deepseek=profile.providerId==='deepseek';
      const request = deepseek ? this.options.textRequest : this.options.connectionRequest;
      if (!request) throw Error("CONNECTION_CHECK_UNAVAILABLE");
      // Only Main consumes the credential. Never return request, headers, history or remote errors.
      const credential = this.options.vault.get(this.binding(profile));
      let failureCode: ApiConnectionCheck["failureCode"] = null;
      const response = await request({
        method: "GET",
        url: deepseek ? "https://api.deepseek.com/models" : "https://api.yourmusic.fun/v1/music/generations/history?page=1&size=1",
        headers: { Authorization: "Bearer " + credential, Accept: "application/json" },
      }).catch(error => { failureCode = connectionFailure(error); return null; });
      await this.lookup(profileId, scope, expectedRevision);
      let state: ApiConnectionCheck["state"] = "unavailable";
      const status = response?.status ?? null;
      if (status === 200) {
        const b = response?.body;
        state = deepseek ? (b && b.object==='list' && Array.isArray(b.data) && b.data.length<=100 && b.data.every((m:any)=>typeof m.id==='string'&&m.id.trim().length>0&&m.id.length<200) ? 'connected':'invalid_response') : b && Array.isArray(b.data) && b.data.length <= 1 &&
          Number.isInteger(b.total) && b.total >= 0 && b.page === 1 && b.size === 1 &&
          Number.isInteger(b.total_pages) && b.total_pages >= 0
          ? "connected" : "invalid_response";
      } else if (status === 401) state = "unauthorized";
      else if (status === 403) state = "forbidden";
      else if (status === 402) state = "credits_required";
      else if (status === 429) state = "rate_limited";
      return { profileId, providerId: deepseek ? "deepseek" : "yourmusic", state, httpStatus: status, failureCode,
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
  async generatePlanCover(input:unknown,prompt:string,beforeSend:()=>Promise<void>,assertActive:()=>void) {
    const {profileId,expectedRevision}=credentialIdentitySchema.parse(input),scope={...this.options.context()};
    if(scope.mode!=='production')throw Error('PRODUCTION_REQUIRED');
    return this.runExclusive(async()=>{
      assertActive();
      const profile=await this.lookup(profileId,scope,expectedRevision);
      if(profile.kind!=='image'||profile.providerId!=='openai_image'||profile.modelId!==openAiCoverModel)
        throw Error('IMAGE_PROFILE_REQUIRED');
      const request=this.options.connectionRequest;
      if(!request)throw Error('IMAGE_TRANSPORT_UNAVAILABLE');
      const credential=this.options.vault.get(this.binding(profile));
      const guard=()=>{assertActive();this.assertScope(scope);};
      const response=await request({
        method:'POST',url:'https://api.openai.com/v1/images/generations',
        headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json',Accept:'application/json'},
        body:{model:profile.modelId,prompt:prompt.slice(0,24000),size:'2048x2048',quality:'medium',n:1,output_format:'jpeg'},
        assertActive:guard,assertDispatch:beforeSend,
      });
      guard();
      if(response.status>=400&&response.status<500)throw Error('IMAGE_HTTP_'+response.status);
      if(response.status!==200)throw Error('IMAGE_OUTCOME_UNKNOWN');
      const results=response.body?.data;
      const encoded=Array.isArray(results)&&results.length===1?results[0]?.b64_json:undefined;
      const maxImageBytes=8*1024**2;
      if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(maxImageBytes/3)*4||encoded.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw Error('IMAGE_RESPONSE_INVALID');
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.length>maxImageBytes||bytes[0]!==0xff||bytes[1]!==0xd8)throw Error('IMAGE_RESPONSE_INVALID');
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
