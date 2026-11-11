import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "rainfall",
  Object.freeze({
    fanqieCatalog:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:fanqie-catalog',action,input),
    fanqieUpload:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:fanqie-upload',action,input),
    tmeAiSubmission:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:tme-ai-submission',action,input),
    tmeAiPrepare:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:tme-ai-prepare',action,input),
    productionFlow:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:production-flow',action,input),
    liveText:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:live-text',action,input),
    liveMusic:(action:string,input:unknown={})=>ipcRenderer.invoke('rainfall:live-music',action,input),
    tmeLive:(action:string,input:unknown)=>ipcRenderer.invoke('rainfall:tme:live',{action,input}),
    tmeInspect: (input:unknown={}) => ipcRenderer.invoke('rainfall:tme:inspect',input),
    tmeSaveDraft: (input:unknown) => ipcRenderer.invoke('rainfall:tme:run',input),
    writeApiCredential: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:write", input),
    clearApiCredential: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:clear", input),
    apiCredentialStatus: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:status", input),
    checkApiConnection: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:check", input),
    call: (method: string, input: unknown = {}) =>
      ipcRenderer.invoke("rainfall:call", method, input),
    pickImport: (role: string, workId?: string, requestId?:string) =>
      ipcRenderer.invoke("rainfall:import", role, workId,requestId),
    exportFile: (kind: string, input: unknown = {}) =>
      ipcRenderer.invoke("rainfall:export", kind, input),
    setMode: (mode: string) => ipcRenderer.invoke("rainfall:mode", mode),
    openOfficial: (provider: string) =>
      ipcRenderer.invoke("rainfall:official", provider),
  }),
);
