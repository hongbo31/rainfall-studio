export type Mode = "production" | "simulation";
export type RpcResult =
  | { ok: true; value: any }
  | { ok: false; error: { code: string; message: string } };
export interface Bridge {
  tmeAiSubmission(action:'preflight'|'status'|'authorizeAndSubmit'|'reconcile',input?:unknown):Promise<RpcResult>;
  tmeAiPrepare(action:'inspect'|'register'|'list'|'context'|'start'|'run'|'reconcile'|'resumePicker'|'resumeCrop',input?:unknown):Promise<RpcResult>;
  productionFlow(action:'savePlan'|'enable'|'disable'|'trigger'|'list'|'context'|'next'|'approve'|'retry'|'capability'|'useManualAssets',input?:unknown):Promise<RpcResult>;
  liveText(action:'prepare'|'run'|'list'|'context',input?:unknown):Promise<RpcResult>;
  liveMusic(action:'stage'|'submit'|'status'|'import'|'recover'|'retryDownloads',input?:unknown):Promise<RpcResult>;
  tmeLive(action:'inspect'|'run'|'review'|'act'|'cancel'|'sync'|'reconcile',input:unknown):Promise<RpcResult>;
  tmeInspect(input?: unknown): Promise<RpcResult>;
  tmeSaveDraft(input: unknown): Promise<RpcResult>;
  writeApiCredential(input: import("./api-profiles").CredentialInput): Promise<RpcResult>;
  clearApiCredential(input: import("./api-profiles").CredentialIdentity): Promise<RpcResult>;
  apiCredentialStatus(input: { profileId: string }): Promise<RpcResult>;
  checkApiConnection(input: import("./api-profiles").CredentialIdentity): Promise<RpcResult>;
  call(method: string, input?: unknown): Promise<RpcResult>;
  pickImport(role: string, workId?: string, requestId?:string): Promise<RpcResult>;
  exportFile(kind: string, input?: unknown): Promise<RpcResult>;
  setMode(mode: Mode): Promise<RpcResult>;
  openOfficial(provider: string): Promise<RpcResult>;
}
declare global {
  interface Window {
    rainfall: Bridge;
  }
}
