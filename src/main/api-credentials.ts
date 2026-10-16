import {
  apiProfileSchema,
  canStoreApiCredential,
  credentialIdentitySchema,
  credentialInputSchema,
  credentialStatusInputSchema,
  type ApiProfile,
  type CredentialStatus,
} from "../shared/api-profiles";
import type { CredentialVault } from "./credentials";

type Context = { mode: string; generation: number };
type Options = {
  vault: CredentialVault;
  getProfile: (id: string) => Promise<ApiProfile | undefined>;
  context: () => Context;
};
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
}

const publicErrors = new Set([
  "IPC_SOURCE_REJECTED",
  "WORKSPACE_CHANGED",
  "PROFILE_NOT_FOUND",
  "REVISION_CONFLICT",
  "PROVIDER_NOT_CONFIGURED",
  "SIMULATION_CREDENTIALS_DISABLED",
  "SECURE_STORAGE_UNAVAILABLE",
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
