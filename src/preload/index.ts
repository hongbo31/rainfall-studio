import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "rainfall",
  Object.freeze({
    writeApiCredential: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:write", input),
    clearApiCredential: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:clear", input),
    apiCredentialStatus: (input: unknown) =>
      ipcRenderer.invoke("rainfall:api-credential:status", input),
    call: (method: string, input: unknown = {}) =>
      ipcRenderer.invoke("rainfall:call", method, input),
    pickImport: (role: string, workId?: string) =>
      ipcRenderer.invoke("rainfall:import", role, workId),
    exportFile: (kind: string, input: unknown = {}) =>
      ipcRenderer.invoke("rainfall:export", kind, input),
    setMode: (mode: string) => ipcRenderer.invoke("rainfall:mode", mode),
    openOfficial: (provider: string) =>
      ipcRenderer.invoke("rainfall:official", provider),
  }),
);
