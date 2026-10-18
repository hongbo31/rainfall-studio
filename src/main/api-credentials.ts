import {
  apiProfileSchema,
  canStoreApiCredential,
  credentialIdentitySchema,
  credentialInputSchema,
  credentialStatusInputSchema,
  type ApiProfile,
  type CredentialStatus,
  type ApiConnectionCheck,
} from "../shared/api-profiles";
import type { CredentialVault } from "./credentials";
import type { HttpTransport } from "../core/workflow/yourmusic";
import {YourMusicAdapter} from '../core/workflow/yourmusic';
import {DeepSeekAdapter} from '../core/workflow/deepseek';

type Context = { mode: string; generation: number };
type Options = {
  vault: CredentialVault;
  getProfile: (id: string) => Promise<ApiProfile | undefined>;
  context: () => Context;
  connectionRequest?: HttpTransport;
  textRequest?: HttpTransport;
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
        return { ...absent, state: "unavailable" };
      return this.options.vault.has(this.binding(profile))
        ? { ...absent, state: "stored_unverified", configured: true }
        : absent;
    } catch {
      return { ...absent, state: "unavailable" };
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
      this.options.vault.put(this.binding(profile), secret);
      await this.lookup(profileId, scope, expectedRevision);
      return this.status(profile);
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
