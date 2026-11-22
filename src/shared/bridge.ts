import type { Bridge, RpcResult } from "./contracts";

const channels = {
  fanqieCatalog: "rainfall:fanqie-catalog",
  fanqieUpload: "rainfall:fanqie-upload",
  tmeAiSubmission: "rainfall:tme-ai-submission",
  tmeAiPrepare: "rainfall:tme-ai-prepare",
  productionFlow: "rainfall:production-flow",
  liveText: "rainfall:live-text",
  liveMusic: "rainfall:live-music",
  remoteAssistConnection: "rainfall:remote-assist-connection",
  remoteAssist: "rainfall:remote-assist",
  tmeLive: "rainfall:tme:live",
  tmeInspect: "rainfall:tme:inspect",
  tmeSaveDraft: "rainfall:tme:run",
  writeApiCredential: "rainfall:api-credential:write",
  clearApiCredential: "rainfall:api-credential:clear",
  apiCredentialStatus: "rainfall:api-credential:status",
  checkApiConnection: "rainfall:api-credential:check",
  call: "rainfall:call",
  pickImport: "rainfall:import",
  exportFile: "rainfall:export",
  setMode: "rainfall:mode",
  openOfficial: "rainfall:official",
} as const satisfies Record<keyof Bridge, string>;

export type BridgeChannel = (typeof channels)[keyof Bridge];
const allowedChannels: ReadonlySet<string> = new Set(Object.values(channels));

export function isBridgeChannel(channel: unknown): channel is BridgeChannel {
  return typeof channel === "string" && allowedChannels.has(channel);
}

export function createBridge(invoke: (channel: BridgeChannel, ...args: unknown[]) => Promise<RpcResult>): Bridge {
  return Object.freeze({
    fanqieCatalog: (action, input = {}) => invoke(channels.fanqieCatalog, action, input),
    fanqieUpload: (action, input = {}) => invoke(channels.fanqieUpload, action, input),
    tmeAiSubmission: (action, input = {}) => invoke(channels.tmeAiSubmission, action, input),
    tmeAiPrepare: (action, input = {}) => invoke(channels.tmeAiPrepare, action, input),
    productionFlow: (action, input = {}) => invoke(channels.productionFlow, action, input),
    liveText: (action, input = {}) => invoke(channels.liveText, action, input),
    liveMusic: (action, input = {}) => invoke(channels.liveMusic, action, input),
    remoteAssistConnection: (action, input = {}) => invoke(channels.remoteAssistConnection, action, input),
    remoteAssist: (action, input = {}) => invoke(channels.remoteAssist, action, input),
    tmeLive: (action, input) => invoke(channels.tmeLive, { action, input }),
    tmeInspect: (input = {}) => invoke(channels.tmeInspect, input),
    tmeSaveDraft: input => invoke(channels.tmeSaveDraft, input),
    writeApiCredential: input => invoke(channels.writeApiCredential, input),
    clearApiCredential: input => invoke(channels.clearApiCredential, input),
    apiCredentialStatus: input => invoke(channels.apiCredentialStatus, input),
    checkApiConnection: input => invoke(channels.checkApiConnection, input),
    call: (method, input = {}) => invoke(channels.call, method, input),
    pickImport: (role, workId, requestId) => {
      if (requestId !== undefined) return invoke(channels.pickImport, role, workId, requestId);
      if (workId !== undefined) return invoke(channels.pickImport, role, workId);
      return invoke(channels.pickImport, role);
    },
    exportFile: (kind, input = {}) => invoke(channels.exportFile, kind, input),
    setMode: mode => invoke(channels.setMode, mode),
    openOfficial: provider => invoke(channels.openOfficial, provider),
  } satisfies Bridge);
}
