export type Mode = "production" | "simulation";
export type RpcResult =
  | { ok: true; value: any }
  | { ok: false; error: { code: string; message: string } };
export interface Bridge {
  writeApiCredential(input: import("./api-profiles").CredentialInput): Promise<RpcResult>;
  clearApiCredential(input: import("./api-profiles").CredentialIdentity): Promise<RpcResult>;
  apiCredentialStatus(input: { profileId: string }): Promise<RpcResult>;
  call(method: string, input?: unknown): Promise<RpcResult>;
  pickImport(role: string, workId?: string): Promise<RpcResult>;
  exportFile(kind: string, input?: unknown): Promise<RpcResult>;
  setMode(mode: Mode): Promise<RpcResult>;
  openOfficial(provider: string): Promise<RpcResult>;
}
declare global {
  interface Window {
    rainfall: Bridge;
  }
}
