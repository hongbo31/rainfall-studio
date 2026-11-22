import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "../shared/bridge";

contextBridge.exposeInMainWorld("rainfall", createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)));
