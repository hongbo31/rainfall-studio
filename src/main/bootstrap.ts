import {createPlanAlbumBroker} from './plan-albums';
import {createTmeAlbumBrowserTransport} from './tme/album-browser';
import {createPlanModelBroker} from './plan-center-models';
import {createPlanPublicationBrokers} from './tme/plan-center-publication';
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  dialog,
  shell,
  utilityProcess,
  net,
  safeStorage,
  Tray,
  Menu,
  crashReporter,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {createHash} from 'node:crypto';
import { validate } from "../shared/schemas";
import type { Mode, RpcResult } from "../shared/contracts";
import { startBrowserStudio } from "./browser-studio";
import { RemoteAssistServer } from "./remote-assist-server";
import { isBridgeChannel, type BridgeChannel } from "../shared/bridge";
import { CredentialVault } from "./credentials";
import {
  ApiCredentials,
  registerApiCredentialHandlers,
} from "./api-credentials";
import { acquireWorkspaceLease, SessionRuntime } from "./session-runtime";
import { resolveDataRoot } from "./data-root";
import {TmeBrowserManager} from './tme/manager';
import {registerTmeBrowserHandlers} from './tme/ipc';
import {TmeLiveManager} from './tme/live';
import {WindowsUiaTransport} from './tme/uia-transport';
import {registerTmeLiveHandlers} from './tme/live-ipc';
import os from 'node:os';
import { nodeHttpsTransport } from '../core/workflow/yourmusic';
import {createLiveMusicBroker} from './live-music';
import {createLiveTextBroker} from './live-text';
import {createProductionFlowBroker,blockedTmePublicationPort} from './production-flow';
import {createTmeAiPrepareBroker,TmeAiNativePort,nativeSnapshot} from './tme/ai-prepare';
import {createTmeAiSubmissionBroker} from './tme/ai-submission';
import {TmeAiCloudSessionManager} from './tme/ai-cloud-session';
import {createAccountIdentityBroker,accountIdentityUiResponse} from './account-identity-broker';
import {fanqieCatalogError} from './fanqie/catalog-session';
import {createFanqieArtists} from './fanqie/artist-creation';
import {FanqieArtistCreationSchema, type FanqieArtistCreationScope} from '../shared/fanqie-artist';
import {FanqieAccountSessions, splitFanqieAccountInput} from './fanqie/account-sessions';
import {PlatformBrowserSessions} from './browser-accounts';
import { createPuleBrowserJobs } from "./pule-browser";
import { puleAudioExtensions } from "../shared/pule-browser";
import { platformAccountLoginUrl, platformPageUrls } from "../shared/platform-directory";
import {AccountWorkWindowSchema, type PlatformAccount} from '../shared/platform-accounts';
import {createPlanFanqiePublisher} from './fanqie/plan-publisher';
import {createPlanFanqieDirectoryPublisher} from './fanqie/plan-directory-publisher';
import {createPlanPuleRunner} from './plan-pule';
import {createUnifiedPublishBroker,createTmeAiTransportProvider} from './tme/unified-publish';
import {externalReceiptBarrier,persistExternalReceiptBarrier,persistExternalReceiptStop} from './tme/external-receipt-barrier';
import {installNativeDiagnostics} from './native-diagnostics';
import {chooseInboxBridgeProject} from './inbox-bridge';
import {chooseDirectoryTaskSource} from './directory-tasks';
import { DownloadArchiveRevisionSchema, downloadArchiveErrors, isConfiguredDownloadKind } from '../shared/download-archive';
import { defaultFanqieAccountId } from '../shared/platform-accounts';
import {createProviderTextBroker} from './provider-text';
import {createMaterialWorkbenchBroker} from './material-workbench';
import {createPlanCoverImageRunner} from './plan-cover-image';
import {createPlatformImageGenerator} from './platform-image';
import {platformImageFailure} from '../shared/platform-image';
import {pathToFileURL} from 'node:url';
import {offlineAcceptanceEnabled,offlineAcceptanceInvocationAllowed} from '../shared/offline-acceptance';
import {startPublishWorkbench,type WorkbenchRequest} from './publish-workbench';
import {qishuiPublishUrl,QishuiReleaseSchema} from '../shared/qishui';
import {QishuiFillSchema,QishuiJobSchema,QishuiAuthorizationSchema,QishuiAcceptSchema} from '../shared/qishui';
import {PlanWorkflowQishuiSubmittedSchema,type PlanWorkflowQishuiJob} from '../shared/plan-workflow-publication';
import {QishuiFlow} from './qishui-flow';
const offlineAcceptance=offlineAcceptanceEnabled();
const browserOnly = process.argv.includes("--rainfall-browser");
const browserNoOpen = browserOnly && process.argv.includes("--rainfall-browser-no-open");
const browserFresh = browserOnly && process.argv.includes("--rainfall-browser-fresh");
let browserStudio: ReturnType<typeof startBrowserStudio> | undefined;
const browserCaller = Symbol("authenticated browser session");
type Invocation = Electron.IpcMainInvokeEvent | typeof browserCaller;
type Handler = (event: Invocation, ...args: any[]) => Promise<RpcResult> | RpcResult;
const browserHandlers = new Map<BridgeChannel, Handler>();

function registerHandler(channel: string, handler: Handler) {
  if (isBridgeChannel(channel)) browserHandlers.set(channel, handler);
  ipcMain.handle(channel, handler);
}

async function browserDispatch(channel: BridgeChannel, args: unknown[]): Promise<RpcResult> {
  const handler = browserHandlers.get(channel);
  if (!handler || switching || closing) return { ok: false, error: { code: "WORKSPACE_UNAVAILABLE", message: "工作区暂不可用。" } };
  if (offlineAcceptance && !offlineAcceptanceInvocationAllowed(channel, args)) {
    return { ok: false, error: { code: "OFFLINE_ACCEPTANCE_ACTION_DISABLED", message: "离线验收仅允许本地素材操作与发布预检" } };
  }
  return handler(browserCaller, ...args);
}

async function openBrowserStudio(open = true) {
  if (closing) throw Error("WORKSPACE_UNAVAILABLE");
  const studio = browserStudio ??= startBrowserStudio(path.join(__dirname, "ui"), {
    dispatch: browserDispatch,
    media: request => request.url.startsWith("media:") ? readMedia(request) : readMaterialCover(request),
  });
  const url = await studio.ready.catch(error => {
    if (browserStudio === studio) browserStudio = undefined;
    throw error;
  });
  if (open) await shell.openExternal(url);
  return url;
}
let publishWorkbench:ReturnType<typeof startPublishWorkbench>|undefined;
let offlineNetworkBlocks=0;
const offlineInvocationCounts:Record<string,number>={};
if(offlineAcceptance){
 const registerHandle=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,listener)=>registerHandle(channel,(event,...args)=>{
  if(!offlineAcceptanceInvocationAllowed(channel,args))return{ok:false,error:{code:'OFFLINE_ACCEPTANCE_ACTION_DISABLED',message:'离线验收仅允许本地素材操作与发布预检'}};
  const method=args[0] as string;offlineInvocationCounts[method]=(offlineInvocationCounts[method]??0)+1;
  return listener(event,...args);
 });
 app.on('web-contents-created',(_event,contents)=>{
  contents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>{offlineNetworkBlocks++;callback({cancel:true});});
 });
}
if (require("electron-squirrel-startup")) app.quit();
protocol.registerSchemesAsPrivileged([
  {scheme:'material-cover',privileges:{standard:true,secure:true,supportFetchAPI:true}},
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const rootArgIndex=process.argv.indexOf('--rainfall-data-root');
const startupRoot=rootArgIndex>=0?process.argv[rootArgIndex+1]:undefined;
if(rootArgIndex>=0&&(!startupRoot||!path.isAbsolute(startupRoot)))throw Error('ABSOLUTE_DATA_ROOT_REQUIRED');
const root = resolveDataRoot(process.env.RAINFALL_DATA_ROOT??startupRoot,
  process.env.RAINFALL_PREVIEW_DATA_ROOT, app.getPath("appData"));
fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
app.setPath("userData", path.join(root, "runtime"));
app.setPath("crashDumps", path.join(root, "runtime", "crashes"));
installNativeDiagnostics({root,app,processEvents:process,crashReporter,metadata:{pid:process.pid,appVersion:app.getVersion(),electronVersion:process.versions.electron}});
app.disableHardwareAcceleration();
let switching = false;
let restarts = 0;
let mode: Mode =
  process.env.RAINFALL_MODE === "simulation" ? "simulation" : "production";
const remoteAssistServer = new RemoteAssistServer({
  directory: path.join(root, "runtime", "remote-assist"),
  legacyDirectory: path.join(root, "runtime", "sms-inbox"),
  apkDirectory: __dirname,
  available: () => mode === "production" && !offlineAcceptance && !switching && !closing,
  protectKey: key => {
    if (!safeStorage.isEncryptionAvailable()) throw Error("ASSIST_SECURE_STORAGE_REQUIRED");
    return safeStorage.encryptString(key).toString("base64");
  },
  openKey: key => {
    try { return safeStorage.decryptString(Buffer.from(key, "base64")); }
    catch { throw Error("ASSIST_SECURE_STORAGE_REQUIRED"); }
  },
});
let child: ReturnType<typeof utilityProcess.fork>;
let window: BrowserWindow | undefined;
const showOpenDialog = (options: Electron.OpenDialogOptions) =>
  window?.isVisible() ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
const showSaveDialog = (options: Electron.SaveDialogOptions) =>
  window?.isVisible() ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
const showMessageBox = (options: Electron.MessageBoxOptions) =>
  window?.isVisible() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
let lease: Awaited<ReturnType<typeof acquireWorkspaceLease>> | undefined;
let tray: Tray | undefined;
const sessionRuntime = new SessionRuntime({
  show: () => {
    if (browserOnly && !window?.isVisible()) {
      if (!browserNoOpen) void openBrowserStudio().catch(() => undefined);
      return;
    }
    window?.show();
    window?.focus();
  },
  hide: () => window?.hide(),
  tray: enabled => setTrayEnabled(enabled || (browserOnly && !browserNoOpen)),
  login: enabled => {
    const args = [
      ...(process.defaultApp ? [app.getAppPath()] : []),
      "--rainfall-data-root", root, "--rainfall-background",
      ...(browserOnly ? ["--rainfall-browser"] : []),
    ];
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
  },
  pause: () => {
    invalidateMusicBrowserJobs("PULE_STOPPED");
    void rpc("internal.pauseAutomation").catch(() => undefined);
  },
  quit: () => app.quit(),
});
function setTrayEnabled(enabled: boolean) {
    if (!enabled) {
      tray?.destroy();
      tray = undefined;
      return;
    }
    if (!tray) {
      tray = new Tray(path.join(app.getAppPath(), "assets", "rainfall.ico"));
      tray.setToolTip("Rainfall Studio · 后台运行；关机和注销时不执行");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开工作台", click: () => sessionRuntime.open() },
          { label: "暂停自动创作", click: () => sessionRuntime.pause() },
          { label: "退出应用", click: () => sessionRuntime.quit() },
        ]),
      );
      tray.on("double-click", () => sessionRuntime.open());
    }
}
// Only saved user runtime preferences activate background execution or login registration.
let ready: Promise<void>;
let coreGeneration = 0;
let interruptTme:()=>void=()=>{};
let importEpoch = 0;
const apiCredentials = new ApiCredentials({
  invalidateMusicModelEvidence: async (identity) => {
    const result=await rpc('internal.planCenter.invalidateModelEvidence',identity);
    if(!result.ok)throw Error(result.error.code);
  },
  connectionRequest: nodeHttpsTransport,
  textRequest: nodeHttpsTransport,
  vault: new CredentialVault(path.join(root, "credentials"), safeStorage),
  context: () => ({
    mode: switching || closing ? "unavailable" : mode,
    generation: coreGeneration,
  }),
  getProfile: async (id) => {
    const result = await rpc("apiProfile.list");
    if (!result.ok) throw Error("PROFILE_LOOKUP_FAILED");
    return result.value.find((profile: { id: string }) => profile.id === id);
  },
});
const generatePlatformImage = createPlatformImageGenerator({
  rpc,
  credentials: apiCredentials,
  captureWorkspace: () => {
    const generation = coreGeneration;
    const epoch = importEpoch;
    return () => {
      if (offlineAcceptance || mode !== "production") throw Error("PRODUCTION_REQUIRED");
      if (switching || closing || generation !== coreGeneration || epoch !== importEpoch) throw Error("WORKSPACE_CHANGED");
    };
  },
});
const planModels=createPlanModelBroker({credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const liveMusic=createLiveMusicBroker({root,credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing});
const liveText=createLiveTextBroker({credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const productionTransport=new WindowsUiaTransport(path.join(__dirname,'tme-uia-host.ps1'));
const productionFlow=createProductionFlowBroker({credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,publication:blockedTmePublicationPort(productionTransport)});
const tmeAiNative=new TmeAiNativePort(path.join(__dirname,'tme-ai-uia-host.ps1'));
const tmeAiCloud=new TmeAiCloudSessionManager({enableExistingAlbum:true,available:()=>mode==='production'&&!switching&&!closing});
const accountIdentity=createAccountIdentityBroker({session:tmeAiCloud,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const accountBrowsers = new PlatformBrowserSessions(root);
const createMusicBrowserJobs = (suno: boolean) => createPuleBrowserJobs({
  root,
  ...(suno ? { provider: "suno_cn" as const } : {}),
  credentials: apiCredentials,
  captureWorkspace: () => {
    const generation = coreGeneration, epoch = importEpoch;
    return () => {
      if (offlineAcceptance || mode !== "production") throw Error("PULE_PRODUCTION_REQUIRED");
      if (switching || closing || generation !== coreGeneration || epoch !== importEpoch)
        throw Error("WORKSPACE_CHANGED");
    };
  },
  chooseAudio: async () => {
    const result = await showOpenDialog({
      title: "选择谱乐 AI 翻唱音频", properties: ["openFile"],
      filters: [{ name: "音频文件", extensions: puleAudioExtensions }],
    });
    if (result.canceled) return null;
    if (result.filePaths.length !== 1) throw Error("PULE_AUDIO_REQUIRED");
    return result.filePaths[0];
  },
  scope: async (accountId, artistId, publication, coverImage) => {
    const result = await rpc(suno ? "internal.sunoCnBrowser.scope" : "internal.puleBrowser.scope", { accountId, artistId, publication, coverImage });
    if (!result.ok) throw Error(result.error.code);
    return result.value;
  },
  coverScope: async (folders, coverImage) => {
    const result = await rpc("internal.sunoCnBrowser.coverScope", { folders, coverImage });
    if (!result.ok) throw Error(result.error.code);
    return result.value;
  },
  withPage: (id, signal, run) => suno ? accountBrowsers.withSunoCnPage(id, signal, run) : accountBrowsers.withPulePage(id, signal, run),
});
const puleJobs = createMusicBrowserJobs(false);
const sunoCnJobs = createMusicBrowserJobs(true);
function invalidateMusicBrowserJobs(code?: string) {
  puleJobs.invalidate(code);
  sunoCnJobs.invalidate(code);
  planPuleRunner.invalidate();
  void accountBrowsers.closeTaskWindows().catch(()=>undefined);
}
const qishuiFlow = new QishuiFlow(root);
async function qishuiAction(method:string,raw:unknown){
 const value=raw as {accountId:string;workId:string;planRunId?:string};
 const {accountId,workId,planRunId}=QishuiJobSchema.parse({accountId:value.accountId,workId:value.workId,planRunId:value.planRunId});
 const generation=coreGeneration;
 const workspaceGuard=()=>{if(offlineAcceptance||mode!=='production'||switching||closing||generation!==coreGeneration)throw Error('WORKSPACE_CHANGED');};
 const statusOnly=method==='publish.qishui.status';
 const readScope=async()=>{
  workspaceGuard();
  if(!planRunId)return;
  const scope=await rpc('internal.planWorkflow.qishuiScope',{runId:planRunId,accountId,workId,readOnly:statusOnly});
  workspaceGuard();
  if(!scope.ok)throw Error(scope.error.code);
  return scope.value as PlanWorkflowQishuiJob;
 };
 const guard=async()=>{await readScope();};
 const scope=await readScope(),account=await browserAccount(accountId);workspaceGuard();
 if(account.provider!=='qishui')throw Error('ACCOUNT_PROVIDER_MISMATCH');
 const job=qishuiFlow.status(accountId,workId);
 if(job&&job.planRunId!==planRunId)throw Error('QISHUI_EXISTING_JOB_REVIEW_REQUIRED');
 if(statusOnly)return {ok:true,value:job};
 if(method==='publish.qishui.fill'){
  const input=QishuiFillSchema.parse(raw);
  if(scope&&(input.variant!==scope.variant||input.performer!==scope.credits.performer||
    input.composer!==scope.credits.composer||input.lyricist!==scope.credits.lyricist||!input.ai))throw Error('WORKFLOW_QISHUI_SCOPE');
  const source=await rpc('internal.qishui.work',input);await guard();
  if(!source.ok)return source;
  await accountBrowsers.open(account,qishuiPublishUrl,workspaceGuard,source.value.artistId);
  const page=await accountBrowsers.qishuiPage(accountId);
  return {ok:true,value:await qishuiFlow.fill(page,input,source.value,guard)};
 }
 if(method==='publish.qishui.authorization'){
  const input=QishuiAuthorizationSchema.parse(raw),page=await accountBrowsers.qishuiPage(accountId);await guard();
  return {ok:true,value:await qishuiFlow.authorization(page,input,guard)};
 }
 if(method==='publish.qishui.contract'){
  const page=await accountBrowsers.qishuiPage(accountId);await guard();
  return {ok:true,value:await qishuiFlow.contract(page,{accountId,workId},guard)};
 }
 if(method==='publish.qishui.accept'){
  const input=QishuiAcceptSchema.parse(raw),page=await accountBrowsers.qishuiPage(accountId);await guard();
  return {ok:true,value:await qishuiFlow.accept(page,input,guard)};
 }
 throw Error('METHOD_NOT_ALLOWED');
}
function qishuiSubmission(raw:unknown){
 const input=PlanWorkflowQishuiSubmittedSchema.parse(raw);
 if(offlineAcceptance||mode!=='production'||switching||closing)throw Error('WORKSPACE_CHANGED');
 const job=qishuiFlow.status(input.accountId,input.workId);
 if(!job||job.planRunId!==input.runId||job.stage!=='verification_required')throw Error('WORKFLOW_QISHUI_VERIFICATION_REQUIRED');
 return rpc('internal.planWorkflow.qishuiSubmitted',input);
}
const fanqieAccounts = new FanqieAccountSessions({root,available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,
  work:async selection=>{const result=await rpc('internal.fanqie.work',selection);if(!result.ok)throw Error(result.error.code);return result.value;},
  downloads:async (accountId,scope)=>{
    const result=await rpc('internal.fanqie.downloads',{accountId,scope});
    if(!result.ok)throw Error(result.error.code);
    return result.value;
  },
  trashDownload:file=>shell.trashItem(file),
  openDiagnostics:async file=>{if(await shell.openPath(file))throw Error('FANQIE_DIAGNOSTICS_OPEN_FAILED');},
  pickBundle:async()=>{const result=await showOpenDialog({title:'选择番茄发布材料清单',properties:['openFile'],filters:[{name:'番茄发布材料清单',extensions:['json']}]});return result.canceled?null:result.filePaths[0];}});
async function browserAccount(accountId:string,artistId?:string):Promise<PlatformAccount>{
  if(mode!=='production'||switching||closing)throw Error('PRODUCTION_REQUIRED');
  const generation=coreGeneration;
  const result=await rpc('internal.accountSession.get',{accountId,artistId});
  if(generation!==coreGeneration||switching||closing)throw Error('WORKSPACE_CHANGED');
  if(!result.ok)throw Error(result.error.code);
  return result.value;
}
async function fanqieAccount(accountId=defaultFanqieAccountId){
  if((await browserAccount(accountId)).provider!=='fanqie')throw Error('ACCOUNT_PROVIDER_MISMATCH');
  return fanqieAccounts.get(accountId);
}
async function fanqieArtistCreation(raw:unknown) {
  try {
    const input=FanqieArtistCreationSchema.parse(raw), generation=coreGeneration;
    if(offlineAcceptance||mode!=='production'||switching||closing)throw Error('PRODUCTION_REQUIRED');
    const resolve=async():Promise<FanqieArtistCreationScope>=>{
      if(generation!==coreGeneration||switching||closing)throw Error('WORKSPACE_CHANGED');
      const result=await rpc('internal.fanqie.artistScope',input);
      if(generation!==coreGeneration||switching||closing)throw Error('WORKSPACE_CHANGED');
      if(!result.ok)throw Error(result.error.code);
      return result.value;
    };
    const scope=await resolve();
    const {upload}=await fanqieAccount(input.accountId);
    if(generation!==coreGeneration||switching||closing)throw Error('WORKSPACE_CHANGED');
    const value=await upload.withArtistCreation(page=>createFanqieArtists(scope,{
      ...page,credentials:apiCredentials,assertSelection:async()=>{
        const current=await resolve();
        if(JSON.stringify(current)!==JSON.stringify(scope))throw Error('FANQIE_ARTIST_SCOPE_CHANGED');
      },
    }));
    return {ok:true as const,value};
  } catch(error) { return {ok:false as const,error:fanqieCatalogError(error)}; }
}
async function platformSession(method:string,input:unknown){
  const {accountId,artistId}=AccountWorkWindowSchema.parse(input);
  const generation=coreGeneration,account=await browserAccount(accountId,artistId);
  const guard=()=>{
    if(mode!=='production'||switching||closing||generation!==coreGeneration)throw Error('WORKSPACE_CHANGED');
  };
  guard();
  if(account.provider==='fanqie'){
    const catalog=fanqieAccounts.get(accountId).catalog,opening=method.endsWith('.open');
    const initial=await catalog.ui(opening?'open':'status');
    const loginState=await catalog.loginState();
    guard();
    const value=opening&&loginState==='valid'&&initial?.profile&&!catalog.status().busy
      ?await catalog.verifyRestoredAccount():catalog.status();
    guard();
    const workWindow=accountBrowsers.workWindow(account,artistId,opening);
    return {...value,opened:value.connected,workWindow,loginState};
  }
  if (account.provider === "yourmusic" && method === "accountSession.status") {
    const status = await accountBrowsers.puleStatus(accountId);
    guard();
    return { ...status, workWindow: accountBrowsers.workWindow(account) };
  }
  return method.endsWith('.open')
    ?accountBrowsers.open(account,platformAccountLoginUrl(account.provider),guard,artistId)
    :{...(account.provider==='qishui'?await accountBrowsers.qishuiStatus(accountId):await accountBrowsers.webStatus(accountId,official[account.provider])),workWindow:accountBrowsers.workWindow(account)};
}
async function prepareQishuiRelease(input:unknown){
  const selection=QishuiReleaseSchema.parse(input);
  const generation=coreGeneration, account=await browserAccount(selection.accountId);
  if(account.provider!=='qishui')throw Error('ACCOUNT_PROVIDER_MISMATCH');
  const result=await rpc('internal.qishui.prepare',selection);
  if(!result.ok)return result;
  if(generation!==coreGeneration||switching||closing)throw Error('WORKSPACE_CHANGED');
  const session=await platformSession('accountSession.open',{accountId:account.id});
  if(generation!==coreGeneration||switching||closing)throw Error('WORKSPACE_CHANGED');
  return {ok:true,value:{...result.value,session}};
}
async function publishRequest(method:string,input:unknown){
  const result=await rpc(method,input);
  if(result.ok&&!offlineAcceptance)void unifiedPublish.pump();
  return result;
}
async function stopPlanWindows(method:string,input:unknown){
  const result=await rpc(method,input);
  if(result.ok){
    if(method==='planCenter.stop')planPuleRunner.stop(result.value.id);
    else for(const link of result.value.linked)if(link.owned)planPuleRunner.stop(link.id);
  }
  return result;
}
async function fanqieUploadAction(action: string, accountId: string | undefined, input: Record<string, unknown>) {
  if (['previewDownloads', 'publishDownloads', 'reconcileDownloads', 'downloadStatus', 'openDownloadDiagnostics'].includes(action) && !accountId)
    throw Error('FANQIE_DOWNLOAD_ACCOUNT_REQUIRED');
  const session = await fanqieAccount(accountId);
  const generation = coreGeneration;
  const workIds = action === 'publishBatch' && input.resume !== true && Array.isArray(input.items)
    ? input.items.map(item => (item as {workId?: string} | null)?.workId)
    : ['publishWork','publishConfigured'].includes(action) && typeof input.workId === 'string' ? [input.workId] : [];
  if (workIds.length) {
    const archived = await rpc('internal.downloadArchive.fanqie', {accountId:accountId ?? defaultFanqieAccountId,workIds});
    if (!archived.ok) return archived;
    if (generation !== coreGeneration || switching || closing) throw Error('WORKSPACE_CHANGED');
  }
  return {ok:true as const,value:await session.upload.ui(action,input)};
}
async function workbenchDispatch({channel,method,input}:WorkbenchRequest){
  try{
    if(offlineAcceptance||mode!=='production'||switching||closing)throw Error('PRODUCTION_REQUIRED');
    if(channel!=='call'){
      const {accountId,actionInput}=splitFanqieAccountInput(input);
      if(channel==='fanqieUpload')return await fanqieUploadAction(method,accountId,actionInput);
      const session=await fanqieAccount(accountId);
      return {ok:true,value:await session.catalog.ui(method,actionInput)};
    }
    const parsed=validate(method,input);
    if(method==='publicationTasks.stop'||method==='planCenter.stop')return stopPlanWindows(method,parsed);
    if(method==='accountSession.open')return {ok:true,value:await platformSession(method,parsed)};
    if(method==='publish.qishui.prepare')return prepareQishuiRelease(parsed);
    if(method.startsWith('publish.qishui.'))return qishuiAction(method,parsed);
    if(method==='publish.simple')return publishRequest(method,parsed);
    if(method==='publish.reconcile')return {ok:true,value:await unifiedPublish.reconcile((parsed as {id:string}).id)};
    if(method==='snapshot'){
      const result=await rpc(method,parsed);
      if(!result.ok)return result;
      const {works,artists,assets,accounts,platformConfigurations,publicationRequests,publicationPipelineJobs,
        publicationPendingTerms,publishSelection,targets,externalTmePublications,mode}=result.value;
      return {ok:true,value:{mode,platformConfigurations,publicationRequests,publicationPipelineJobs,publicationPendingTerms,
        publishSelection,targets,externalTmePublications,materialWorkbench:{materials:[],sources:[]},
        works:works.map(({id,title,artistId,assets,selectedAudioVariant,revision}:any)=>({id,title,artistId,assets,selectedAudioVariant,revision})),
        artists:artists.map(({id,name}:any)=>({id,name})),
        assets:assets.map(({id,kind,bytes,sha256}:any)=>({id,kind,bytes,sha256})),
        accounts:accounts.map(({id,name,provider}:any)=>({id,name,provider})),
      }};
    }
    return rpc(method,parsed);
  }catch(error){return {ok:false,error:fanqieCatalogError(error)};}
}
const planFanqiePublisher=createPlanFanqiePublisher({
  rpc,upload:fanqieAccounts.get().upload,forAccount:async id=>(await fanqieAccount(id)).upload,
  assertAccount:async id=>{await browserAccount(id);},
  resolveWorkflowAccount:async id=>(await fanqieAccount(id)).upload.resolveWorkflowAccount(),
  readAuthorization:async (id,queries)=>{
    const {catalog,upload}=await fanqieAccount(id);
    if(!catalog.status().connected||upload.status().busy)return;
    return catalog.run(async(context,guard)=>(await catalog.inspect(context,guard,false,undefined,queries)).report);
  },
  available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,
});
const planFanqieDirectoryPublisher=createPlanFanqieDirectoryPublisher({
  rpc,forAccount:async id=>(await fanqieAccount(id)).upload,
  available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,
});
const planPuleRunner=createPlanPuleRunner({rpc,credentials:apiCredentials,
  available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,
  browser:{stagingDirectory:path.join(root,'staging'),
    withTaskPage:(scope,signal,operation)=>accountBrowsers.withTaskMusicPage(scope,signal,operation),
    withHistoryPage:(accountId,signal,read)=>accountBrowsers.withPuleHistoryPage(accountId,signal,read),
    closeTaskWindow:id=>accountBrowsers.closeTaskWindow(id)},
});
const planCoverImageRunner=createPlanCoverImageRunner({rpc,credentials:apiCredentials,
  available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,
});
tmeAiCloud.onIdentityInvalidated(()=>{try{child?.postMessage({kind:'account-identity-invalidated'})}catch{/* Old worker already stopped. */}});
// Cloud sessions and calibrated browser contracts must be supplied by Main, never renderer flags.
const tmeAiTransport=createTmeAiTransportProvider({platform:process.platform,cloudSession:()=>tmeAiCloud.submissionSession(),cloudExistingAlbumSession:()=>tmeAiCloud.existingAlbumSession(),readExternalReceipt:async(context)=>{const receipt=await tmeAiCloud.readExternalReceipt(context);persistExternalReceiptBarrier(root,receipt);return receipt},cloudPreparationSession:()=>tmeAiCloud.preparationSession(),native:tmeAiNative,nativeObserve:async(context)=>{
  const g=context.grant.input;
  return nativeSnapshot((await tmeAiNative.request('observe',{binding:g.binding,artistName:g.metadata.artistName})).snapshot);
}});
async function checkExternalReceiptBarrier(scope:any){const result=await rpc('internal.tmeAiSubmission.externalRecords',{});if(!result.ok)throw Error('EXTERNAL_RECEIPT_SCAN_REQUIRED');for(const receipt of result.value)persistExternalReceiptStop(root,receipt);return externalReceiptBarrier(root,scope)}
const planPublications=createPlanPublicationBrokers({prepare:{publicationBarrier:checkExternalReceiptBarrier,root,rpc:(method,input)=>rpc(method,input),port:tmeAiTransport.prepare,resolveScope:async(workId,createDerivative)=>{const result=await rpc('internal.tmeAiPrepare.resolveScope',{workId,createDerivative});if(!result.ok)throw Error(result.error.code);return result.value},available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,nativeHostHash:()=>createHash('sha256').update(fs.readFileSync(tmeAiNative.script)).digest('hex')},submission:{root,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,observe:tmeAiTransport.observe,executor:tmeAiTransport.executor}});
const tmeAiPrepare=planPublications.prepare,tmeAiSubmission=planPublications.submission;
const unifiedPublish=createUnifiedPublishBroker({rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,publicationBarrier:checkExternalReceiptBarrier,preparationCapability:tmeAiTransport.preparationCapability,prepare:tmeAiPrepare,submission:tmeAiSubmission});
// Catalog and creation share the exact native lock with preparation/submission.
const albumSessions=new WeakMap<object,ReturnType<typeof createTmeAlbumBrowserTransport>>();
const planAlbums=createPlanAlbumBroker({rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,getSession:()=>{
 const session=tmeAiCloud.existingAlbumSession();if(!session)return undefined;
 let transport=albumSessions.get(session);
 if(!transport){
  const rawTransport=createTmeAlbumBrowserTransport(session);
  transport={...rawTransport,catalog:input=>planPublications.native(()=>rawTransport.catalog(input)),select:input=>planPublications.native(()=>rawTransport.select(input)),create:input=>planPublications.native(()=>rawTransport.create(input)),reconcile:input=>planPublications.native(()=>rawTransport.reconcile(input))};
  albumSessions.set(session,transport);
 }
 return{transport,account:()=>planPublications.native(()=>session.account())};
},onAppend:()=>unifiedPublish.pump(),reconcileAppend:taskId=>unifiedPublish.reconcile(taskId)});
const providerText=createProviderTextBroker({credentials:apiCredentials,rpc,available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const lyricWriting=createProviderTextBroker({queue:'lyricWriting',credentials:apiCredentials,rpc,available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const materialWorkbench=createMaterialWorkbenchBroker({credentials:apiCredentials,rpc,available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,chooseDirectory:()=>showOpenDialog({title:'选择只读素材目录',properties:['openDirectory']})});
app.on('before-quit',()=>providerText.stop());
app.on('before-quit',()=>lyricWriting.stop());
setInterval(()=>{if(!offlineAcceptance)void lyricWriting.pump().catch(()=>undefined);},2000).unref();
setInterval(()=>{if(offlineAcceptance)return;void productionFlow.pump();void unifiedPublish.pump();void providerText.pump().catch(()=>undefined);void materialWorkbench.pump().catch(()=>undefined);void planPuleRunner.pump().catch(()=>undefined);void planCoverImageRunner.pump().catch(()=>undefined);void planFanqiePublisher.pump().catch(()=>undefined);},2000).unref();
setInterval(()=>{if(!offlineAcceptance)void planFanqieDirectoryPublisher.pump().catch(()=>undefined);},2000).unref();
setInterval(()=>{
  if(offlineAcceptance)return;
  void fanqieAccounts.pumpDownloadCleanup()
    .then(()=>planFanqieDirectoryPublisher.recoverLegacyCleanup()).catch(()=>undefined);
},15_000).unref();
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }
>();
function startCore() {
  void tmeAiCloud.disconnect().catch(()=>{});
  coreGeneration++;
  invalidateMusicBrowserJobs();
  ready = new Promise((resolve, reject) => {
    child = utilityProcess.fork(
      path.join(__dirname, "core.cjs"),
      [root, mode],
      { stdio: "pipe", serviceName: "Rainfall Core" },
    );
    const worker = child;
    child.stdout?.on("data", (b) => console.log(b.toString()));
    child.stderr?.on("data", (b) => console.error(b.toString()));
    child.on("message", (m) => {
      if(m.kind==='account-identity-request'){
        const generation=coreGeneration,assertCurrent=()=>{if(child!==worker||generation!==coreGeneration)throw Error('STALE_CORE_GENERATION')};
        void accountIdentity.provider(m,assertCurrent).then(value=>{if(child===worker&&generation===coreGeneration)worker.postMessage({kind:'account-identity-result',id:m.id,ok:true,value})},error=>{if(child===worker&&generation===coreGeneration){const code=error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'IDENTITY_READ_FAILED';worker.postMessage({kind:'account-identity-result',id:m.id,ok:false,error:{code}})}});return;
      }
      if(m.kind==='music-provider'){
        const generation=coreGeneration;
        const assertCurrent=()=>{if(child!==worker||generation!==coreGeneration)throw Error('STALE_CORE_GENERATION')};
        void liveMusic.provider(m,assertCurrent).then(value=>{if(child===worker&&generation===coreGeneration)worker.postMessage({kind:'music-provider-result',id:m.id,ok:true,value})},()=>{if(child===worker&&generation===coreGeneration)worker.postMessage({kind:'music-provider-result',id:m.id,ok:false})});return;
      }
      if (m.ready) {
        resolve();
        return;
      }
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        p.resolve(m.result);
      }
    });
    child.on("exit", (code) => {
      if (child !== worker) return;
      interruptTme();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("CORE_EXITED"));
      }
      pending.clear();
      if (code) reject(new Error("CORE_START_FAILED"));
      if ((window || browserStudio) && !closing && !switching && restarts++ < 3) {
        startCore();
        ready.catch(() => undefined);
      }
    });
  });
}
async function rpc(method: string, input: any = {}) {
  await ready;
  return new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("OPERATION_TIMEOUT"));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    child.postMessage({ id, method, input });
  });
}
function trusted(event: Invocation) {
  if (event === browserCaller) return;
  if (
    !window || !event.senderFrame ||
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame.url.startsWith("app://ui/")
  )
    throw Error("IPC_SOURCE_REJECTED");
}
async function safe(fn: () => any) {
  try {
    return await fn();
  } catch (e: any) {
    return {
      ok: false,
      error: {
        code:
          e.message === 'WORKSPACE_CHANGED' ? 'WORKSPACE_CHANGED' : e.message === "METHOD_NOT_ALLOWED"
            ? "METHOD_NOT_ALLOWED"
            : "REQUEST_REJECTED",
        message:
          e.message === 'WORKSPACE_CHANGED' ? '工作区已切换或恢复，请重新选择文件。' : e.message === "METHOD_NOT_ALLOWED"
            ? "不允许的操作"
            : "操作失败，请检查输入或本地文件。",
      },
    };
  }
}
const official: Record<string, string> = {
  ...platformPageUrls,
  yourmusicWorks: "https://app.yourmusic.fun/personal",
};
function handlers() {
  registerHandler("rainfall:remote-assist", (event, action, input) => safe(async () => {
    trusted(event);
    try { return { ok: true, value: await remoteAssistServer.remoteUi(action, input) }; }
    catch (error) {
      const messages: Record<string, string> = {
        ASSIST_PRODUCTION_REQUIRED: "请切换到真实本地库后使用远控。",
        ASSIST_STORE_UNAVAILABLE: "无法读取已配对设备，请检查本地数据目录。",
        ASSIST_RECEIVER_REQUIRED: "请先在远控页点击「启动连接」。",
        ASSIST_DEVICE_REQUIRED: "请重新选择已配对的手机。",
        ASSIST_BUSY: "请先结束当前远控会话。",
        ASSIST_EXPIRED: "会话已结束，请重新发起。",
        ASSIST_VIEW_ONLY: "此会话只共享画面。",
        ASSIST_FRAME_CHANGED: "画面已更新，请重试操作。",
        ASSIST_INPUT_PENDING: "上一项操作处理中。",
      };
      const code = error instanceof Error && Object.hasOwn(messages, error.message) ? error.message : "ASSIST_REQUEST_REJECTED";
      return { ok: false, error: { code, message: messages[code] ?? "请检查远控设置后重试。" } };
    }
  }));
  registerHandler("rainfall:remote-assist-connection", (event, action, input) => safe(async () => {
    trusted(event);
    try { return { ok: true, value: await remoteAssistServer.connectionUi(action, input) }; }
    catch (error) {
      const messages: Record<string, string> = {
        ASSIST_PRODUCTION_REQUIRED: "请切换到真实本地库后使用远控。",
        ASSIST_INTERFACE_REQUIRED: "请选择电脑当前可用的本地网卡。",
        ASSIST_RECEIVER_REQUIRED: "请先启动连接。",
        ASSIST_RECEIVER_BUSY: "连接服务正在切换，请稍后重试。",
        ASSIST_RECEIVER_ALREADY_RUNNING: "请先停止连接，再切换网卡。",
        ASSIST_RECEIVER_STOPPED: "连接服务已停止，请重新启动。",
        ASSIST_PORT_UNAVAILABLE: "配对地址暂不可用，请检查所选网卡和端口。",
        ASSIST_STORE_UNAVAILABLE: "无法读取已配对设备，请检查本地数据目录。",
        ASSIST_SECURE_STORAGE_REQUIRED: "无法读取本机的加密配对凭据。",
      };
      const code = error instanceof Error && Object.hasOwn(messages, error.message) ? error.message : "ASSIST_REQUEST_REJECTED";
      return { ok: false, error: { code, message: messages[code] ?? "请检查远控连接设置后重试。" } };
    }
  }));
  registerHandler('rainfall:fanqie-upload',(event,action,input)=>safe(async()=>{
    trusted(event);
    try {
      const {accountId,actionInput}=splitFanqieAccountInput(input);
      return await fanqieUploadAction(action,accountId,actionInput);
    }
    catch (error) {return {ok:false,error:fanqieCatalogError(error)}}
  }));
  registerHandler('rainfall:fanqie-catalog',(event,action,input)=>safe(async()=>{
    trusted(event);
    try {
      const {accountId,actionInput}=splitFanqieAccountInput(input);
      return {ok:true,value:await (await fanqieAccount(accountId)).catalog.ui(action,actionInput)};
    }
    catch (error) {return {ok:false,error:fanqieCatalogError(error)}}
  }));
    registerHandler('rainfall:tme-ai-submission',(event,action,input)=>safe(async()=>{
      trusted(event);
      try{return{ok:true,value:await tmeAiSubmission.ui(action,input)}}catch(e){
        const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REQUEST_REJECTED';
        return{ok:false,error:{code,message:'腾讯 AI 检查未完成：'+code+'。'}};
      }
    }));
  registerHandler('rainfall:tme-ai-prepare',(event,action,input)=>safe(async()=>{
    trusted(event);
    try{if(action==='connectBrowser')return{ok:true,value:await tmeAiCloud.connect(input)};if(action==='inspectBrowserAccount')return{ok:true,value:await tmeAiCloud.inspectAccount(input)};if(action==='fillIntakeFields')return{ok:true,value:await tmeAiCloud.fillIntakeFields(input)};if(action==='browserStatus')return{ok:true,value:tmeAiCloud.status()};if(action==='disconnectBrowser')return{ok:true,value:await tmeAiCloud.disconnect()};const value=await tmeAiPrepare.ui(action,input);if(['register','start','run','reconcile','resumePicker','resumeCrop'].includes(action))void unifiedPublish.pump();return{ok:true,value}}catch(e){
      const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REQUEST_REJECTED';
      return{ok:false,error:{code,message:'腾讯AI准备未完成：'+code+'。未知结果须只读核对，禁止重复上传；尚未接受条款或正式提交。'}};
    }
  }));
  registerHandler('rainfall:production-flow',(event,action,input)=>safe(async()=>{
    trusted(event);
    try{return{ok:true,value:await productionFlow.ui(action,input)}}catch(e){
      const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REQUEST_REJECTED';
      return{ok:false,error:{code,message:'生产流程操作未完成：'+code+'。请查看本轮状态、配置和授权。'}};
    }
  }));
  registerHandler('rainfall:live-music',(event,action,input)=>safe(async()=>{trusted(event);return{ok:true,value:await liveMusic.ui(action,input)}}));
  registerHandler('rainfall:live-text',(event,action,input)=>safe(async()=>{
    trusted(event);
    try{return{ok:true,value:await liveText.ui(action,input)}}catch(e){
      const messages:Record<string,string>={CREDENTIAL_REQUIRED:'请先在账号设置保存 DeepSeek Key。未发起文本调用。',BUDGET_INSUFFICIENT:'本轮剩余预算不足以覆盖保守预留，未发起请求。',TEXT_TASK_BUSY:'原文本请求仍在处理中，请读取原任务结果。',TEXT_PROVIDER_BUSY:'此文本配置仍有进行中的请求，请等待原任务。',OUTCOME_UNKNOWN:'原请求结果或费用未知，禁止自动重发。',PROVIDER_RISK_FROZEN:'此配置存在费用或结果未核实的请求，请先核对原单。',REVISION_LIMIT:'已达到本轮确认的改写次数上限。',REVISION_CONFLICT:'任务或配置版本已变化，请刷新后查看。',REVISION_FEEDBACK_REQUIRED:'请填写本次改写反馈。',TEXT_PROFILE_REQUIRED:'请选择有效的 DeepSeek 文本配置。',WORKSPACE_CHANGED:'工作区已切换，请重新读取原任务。',PRODUCTION_REQUIRED:'真实文本调用仅在真实工作区开放。'};
      const code=e instanceof Error&&messages[e.message]?e.message:'REQUEST_REJECTED';
      return{ok:false,error:{code,message:messages[code]??'文本操作未完成，请核对配置、预算和任务状态。'}};
    }
  }));
  let checkTmeScope:()=>void = () => { throw Error('BROWSER_AUTHORIZATION_REQUIRED'); };
  const tme = new TmeBrowserManager({
    get: async id => { const r=await rpc('internal.tme.get',{id});if(!r.ok)throw Error(r.error.code);return r.value; },
    list: async () => { const r=await rpc('internal.tme.list');if(!r.ok)throw Error(r.error.code);return r.value; },
    update: async (id,revision,patch) => {const r=await rpc('internal.tme.update',{id,revision,patch});if(!r.ok)throw Error(r.error.code);return r.value;},
    bind: async (id,revision,identity) => {const r=await rpc('internal.tme.bind',{id,revision,identity});if(!r.ok)throw Error(r.error.code);return r.value;},
    assertCurrent: async draft => {checkTmeScope();const r=await rpc('internal.tme.current',{id:draft.id});if(!r.ok)throw Error(r.error.code);},
  });
  const tmeScope=registerTmeBrowserHandlers((name,fn)=>registerHandler(name,fn),trusted,tme,{mode:()=>mode,generation:()=>coreGeneration,unavailable:()=>switching||closing});
  checkTmeScope = tmeScope.assertScope;
  let checkLiveScope:()=>void=()=>{throw Error('WINDOW_BINDING_REQUIRED');};
  const liveRpc=async(action:string,input:Record<string,unknown>={})=>{checkLiveScope();const r=await rpc('internal.tme.live',{action,...input});if(!r.ok)throw Error(r.error.code);return r.value;};
  const liveManager=new TmeLiveManager({
    units:id=>liveRpc('units',{id}),batches:()=>liveRpc('batches'),
    get:async id=>{checkLiveScope();const r=await rpc('internal.tme.get',{id});if(!r.ok)throw Error(r.error.code);return r.value;},
    assertCurrent:async d=>{checkLiveScope();const r=await rpc('internal.tme.current',{id:d.id});if(!r.ok)throw Error(r.error.code);},
    updateUnit:(id,patch)=>liveRpc('updateUnit',{id,patch}),updateBatch:(id,patch)=>liveRpc('updateBatch',{id,patch}),claim:(id,identity)=>liveRpc('claim',{id,identity}),start:id=>liveRpc('start',{id}),
  },new WindowsUiaTransport(path.join(__dirname,'tme-uia-host.ps1')),os.hostname());
  const liveScope=registerTmeLiveHandlers((name,fn)=>registerHandler(name,fn),trusted,liveManager,{mode:()=>mode,generation:()=>coreGeneration,unavailable:()=>switching||closing});
  checkLiveScope=liveScope.assertScope;
  interruptTme=()=>{void tmeAiCloud.disconnect().catch(()=>{});tmeScope.invalidate();liveScope.invalidate();tmeAiNative.interrupt();};
  app.on('before-quit',()=>liveManager.dispose());
  registerApiCredentialHandlers(
    (channel, handler) => registerHandler(channel, handler),
    trusted,
    apiCredentials,
  );
  registerHandler("rainfall:call", (e, method, input) =>
    safe(async () => {
      trusted(e);
      const parsed = validate(method, input);
      if (method === "planCenter.retryFanqieCleanup") {
        try {
          return { ok: true, value: await planFanqieDirectoryPublisher.retryCleanup(parsed) };
        } catch (error) {
          return { ok: false, error: fanqieCatalogError(error) };
        }
      }
      if (method === "planCenter.openFanqieDiagnostics") {
        const generation = coreGeneration;
        const result = await rpc("internal.planFanqieDirectory.diagnostics", parsed);
        if (!result.ok) return result;
        if (generation !== coreGeneration || switching || closing) throw Error("WORKSPACE_CHANGED");
        if (await shell.openPath(result.value.file)) return { ok: false, error: fanqieCatalogError(Error("FANQIE_DIAGNOSTICS_OPEN_FAILED")) };
        return { ok: true, value: null };
      }
      if (method === "platformImage.generate") {
        try {
          return { ok: true, value: await generatePlatformImage(parsed) };
        } catch (error) {
          return { ok: false, error: platformImageFailure(error) };
        }
      }
      if(method==='fanqie.artistCreate')return fanqieArtistCreation(parsed);
      if (method.startsWith("puleBrowser.") || method.startsWith("sunoCnBrowser.")) {
        const jobs = method.startsWith("sunoCnBrowser.") ? sunoCnJobs : puleJobs;
        try {
          switch (method.split(".")[1]) {
            case "status":
              return { ok: true, value: mode === "production" && !offlineAcceptance ? jobs.status() : [] };
            case "history":
              return { ok: true, value: mode === "production" && !offlineAcceptance ? jobs.history() : [] };
            case "chooseAudio": return { ok: true, value: await jobs.chooseAudio() };
            case "start": return { ok: true, value: await jobs.start(parsed) };
            case "retryCovers": return { ok: true, value: await jobs.retryCovers(parsed) };
            case "confirm": return { ok: true, value: jobs.confirm(parsed) };
            case "stop": return { ok: true, value: jobs.stop(parsed) };
          }
        } catch (error) {
          const code = error instanceof Error && /^(?:PULE_[A-Z_]+|SUNO_CN_[A-Z_]+|DOWNLOAD_ROOT_[A-Z_]+|WORKSPACE_CHANGED|IMAGE_PROFILE_REQUIRED|IMAGE_MODEL_REQUIRED|REVISION_CONFLICT)$/u.test(error.message)
            ? error.message : "PULE_REQUEST_FAILED";
          return { ok: false, error: { code, message: code } };
        }
      }
      if(method==='publish.qishui.prepare')return prepareQishuiRelease(parsed);
      if(method.startsWith('publish.qishui.'))return qishuiAction(method,parsed);
      if(method==='planCenter.qishuiSubmitted')return qishuiSubmission(parsed);
      if(method==="accountSession.status"||method==="accountSession.open"){
        try {
          return {ok:true,value:await platformSession(method,parsed)};
        } catch(error){return {ok:false,error:fanqieCatalogError(error)};}
      }
        if(method.startsWith('materials.'))return{ok:true,value:await materialWorkbench.ui(method.slice('materials.'.length),parsed)};
      if(method.startsWith('accountIdentity.'))return accountIdentityUiResponse(()=>accountIdentity.ui(method.slice('accountIdentity.'.length),parsed));
      if(method==='directoryTasks.chooseDirectory')return chooseDirectoryTaskSource(parsed,{
        capture:()=>({mode,generation:coreGeneration,epoch:importEpoch,available:!switching&&!closing}),
        choose:()=>showOpenDialog({title:'选择任务请求目录',properties:['openDirectory']}),rpc,
      });
      if(method==='downloadArchive.chooseDirectory'){
        const selection=DownloadArchiveRevisionSchema.parse(parsed),generation=coreGeneration,epoch=importEpoch;
        const result=await showOpenDialog({title:'选择歌曲和发布材料的下载目录',properties:['openDirectory']});
        if(generation!==coreGeneration||epoch!==importEpoch||switching||closing)throw Error('WORKSPACE_CHANGED');
        if(result.canceled)return {ok:true,value:null};
        if(result.filePaths.length!==1)throw Error('DIRECTORY_SELECTION_REQUIRED');
        return rpc('internal.downloadArchive.configureDirectory',{...selection,root:result.filePaths[0]});
      }
      if(method==='inbox.bridge.chooseDirectory')return chooseInboxBridgeProject({
        capture:()=>({mode,generation:coreGeneration,epoch:importEpoch,available:!switching&&!closing}),
        choose:()=>showOpenDialog({title:'选择专用 dot-delivery 项目目录（包含 incoming 和 receipts）',properties:['openDirectory']}),rpc,
      });
      if(method==='runtime.settings')return{ok:true,value:sessionRuntime.status()};
      if(method==='runtime.configure'){
        const settings=sessionRuntime.configure(parsed as {backgroundEnabled:boolean;loginAtStartup:boolean},true);
        const file=path.join(root,'runtime-preferences.json');fs.writeFileSync(file+'.tmp',JSON.stringify(settings));fs.renameSync(file+'.tmp',file);
        return{ok:true,value:settings};
      }
      if (method === "runtime")
        return {
          ok: true,
          value: {
            mode,
            root,
            versions: process.versions,
            packaged: app.isPackaged,
              offlineAcceptance,
              offlineNetworkBlocks,
              offlineInvocationCounts:{...offlineInvocationCounts},
            appVersion: app.getVersion(),
            externalConnections: null,
            networkObservationScope: 'not_measured_by_runtime',
          },
        };
      if(method==="planCenter.refreshModels")return{ok:true,value:await planModels.ui("refresh",parsed)};
      if(['planAlbums.refresh','planAlbums.capabilities','planAlbums.confirm','planAlbums.reconcile'].includes(method))return{ok:true,value:await planAlbums.ui(method.slice('planAlbums.'.length),parsed)};

      if (method === "publish.reconcile") return {ok:true,value:await unifiedPublish.reconcile((parsed as {id:string}).id)};
      if (method === "publish.simple" && mode === 'production') {
        return publishRequest(method,parsed);
      }
      if (method === 'creationTasks.start'||method === 'creationTasks.checkReceipt') {
        const result = await rpc(method,parsed);
        if (result.ok && !offlineAcceptance && (method === 'creationTasks.checkReceipt'||(parsed as {outputs:{music:boolean}}).outputs.music))
          void planPuleRunner.pump().catch(() => undefined);
        return result;
      }
      if(method==='publicationTasks.stop'||method==='planCenter.stop')return stopPlanWindows(method,parsed);
      return ["apiProfile.save", "platformImage.prepareCredential", "platformImage.setDefault"].includes(method)
        ? apiCredentials.runExclusive(() => rpc(method, parsed))
        : rpc(method, parsed);
    }),
  );
  registerHandler("rainfall:import", (e, role, workId, requestId) =>
    safe(async () => {
      trusted(e);
      if (
        ![
          "audio_A",
          "audio_B",
          "cover",
          "cover_B",
          "rights",
          "certificate",
          "report",
          "legacy",
          "backup",
          "lyrics",
          "coverResultImage",
          "coverResultManifest",
        ].includes(role)
      )
        throw Error("ROLE");
      if (workId && !/^[a-f0-9-]{36}$/.test(workId)) throw Error("WORK_ID");
      if((role==='certificate'||role==='cover_B')&&!workId)throw Error('WORK_ID_REQUIRED');
      const importGeneration=coreGeneration;
      const dialogEpoch=importEpoch;
      if(role.startsWith('coverResult')&&(!workId||typeof requestId!=='string'||!/^[a-f0-9-]{36}$/.test(requestId)))throw Error('COVER_REQUEST_REQUIRED');
      const r = await showOpenDialog({
        title: role === "backup" ? "选择备份恢复" : role === 'certificate' ? '选择原创证书' : "导入本地文件",
        properties: ["openFile"],
        ...(role === 'certificate' ? {filters:[{name:'原创证书',extensions:['pdf','png','jpg','jpeg','webp']}]} : {}),
      });
      if (r.canceled) return { ok: true, value: null };
      if(importGeneration!==coreGeneration||dialogEpoch!==importEpoch||switching||closing)throw Error('WORKSPACE_CHANGED');
      if (role === "legacy") {
        const preview = await rpc("internal.previewLegacy", {
          source: r.filePaths[0],
        });
        if (!preview.ok) return preview;
        const confirmation = await showMessageBox({
          type: "question",
          title: "原型迁移预览",
          message: "将导入 " + preview.value.works + " 首作品到隔离模拟库。",
          detail:
            "旧音频blob无法迁移；需要重新导入 " +
            preview.value.missingAudio +
            " 首音频。原型数据保留，不恢复真实发布状态。",
          buttons: ["确认导入", "取消"],
          defaultId: 1,
          cancelId: 1,
        });
        if (confirmation.response !== 0) return { ok: true, value: null };
      }
      const performImport = () =>
        rpc("internal.import", { role, workId, requestId, source: r.filePaths[0] });
      return role === "backup"
        ? apiCredentials.runExclusive(async()=>{if(tmeScope.isBusy()||liveScope.isBusy())throw Error('TME_BUSY');tmeScope.invalidate();liveScope.invalidate();importEpoch++;switching=true;invalidateMusicBrowserJobs();try{await tmeAiCloud.disconnect();return await performImport()}finally{switching=false}})
        : performImport();
    }),
  );
  registerHandler("rainfall:export", (e, kind, input) =>
    safe(async () => {
      trusted(e);
      if (switching || closing) throw Error("WORKSPACE_CHANGED");
      if (isConfiguredDownloadKind(kind)) {
        const result = await rpc("internal.export", { kind, input });
        if (!result.ok) {
          const message = downloadArchiveErrors[result.error.code];
          if (message) return { ok: false, error: { ...result.error, message } };
        }
        return result;
      }
      if (kind !== "backup" && kind !== "diagnostics") throw Error("KIND");
      const generation = coreGeneration, epoch = importEpoch;
      const ext = kind === "backup" ? "rainfall-backup.zip" : "txt";
      const r = await showSaveDialog({
        defaultPath: `Rainfall-${kind}-${Date.now()}.${ext}`,
      });
      if (r.canceled) return { ok: true, value: null };
      if (generation !== coreGeneration || epoch !== importEpoch || switching || closing) throw Error("WORKSPACE_CHANGED");
      return rpc("internal.export", { kind, input, destination: r.filePath });
    }),
  );
  registerHandler("rainfall:mode", (e, next) =>
    safe(() =>
      apiCredentials.runExclusive(async () => {
        trusted(e);
        if (!["production", "simulation"].includes(next)) throw Error("MODE");
          if(tmeScope.isBusy()||liveScope.isBusy())throw Error('TME_BUSY');
          tmeScope.invalidate();
          liveScope.invalidate();
        switching = true;
        invalidateMusicBrowserJobs();
        tmeAiNative.interrupt();
        await tmeAiCloud.disconnect();
        try {
          await remoteAssistServer.close();
          await rpc("internal.close");
          child.kill();
          mode = next;
          startCore();
          await ready;
          return { ok: true, value: { mode } };
        } finally {
          switching = false;
        }
      }),
    ),
  );
  registerHandler("rainfall:official", (e, provider) =>
    safe(async () => {
      trusted(e);
      if (provider === 'browserStudio') {
        if (offlineAcceptance) throw Error('OFFLINE_ACCEPTANCE_ACTION_DISABLED');
        await openBrowserStudio();
        return { ok: true, value: true };
      }
      if(provider==='publishWorkbench'){
        if(offlineAcceptance||mode!=='production'||switching||closing)throw Error('PRODUCTION_REQUIRED');
        publishWorkbench??=startPublishWorkbench(path.join(__dirname,'ui'),workbenchDispatch);
        const current=publishWorkbench;
        const url=await current.ready.catch(error=>{if(publishWorkbench===current)publishWorkbench=undefined;throw error;});
        await shell.openExternal(url);
        return {ok:true,value:true};
      }
      if (typeof provider !== "string" || !Object.hasOwn(official, provider)) throw Error("PROVIDER");
      await shell.openExternal(official[provider]);
      return { ok: true, value: true };
    }),
  );
}
async function readMaterialCover(request: Request): Promise<Response> {
      try{
        const url=new URL(request.url),generation=coreGeneration,parts=url.pathname.slice(1).split('/'),uuid=/^[a-f0-9-]{36}$/;
        if(switching||closing)return new Response('Not found',{status:404});
        let result;
        if(url.host==='preview'&&parts.length===2&&parts.every(part=>uuid.test(part))){const sha256=url.searchParams.get('sha256');if(!sha256||!/^[a-f0-9]{64}$/.test(sha256))return new Response('Not found',{status:404});result=await rpc('internal.materials.previewCoverPath',{previewId:parts[0],rowId:parts[1],sha256});}
        else{const materialId=parts[0],revision=Number(url.searchParams.get('revision'));if(url.host!=='cover'||parts.length!==1||!uuid.test(materialId)||!Number.isSafeInteger(revision)||revision<1)return new Response('Not found',{status:404});result=await rpc('internal.materials.coverPath',{materialId,revision});}
        if(!result.ok||generation!==coreGeneration||switching||closing)return new Response('Not found',{status:404});
        const response=await net.fetch(pathToFileURL(result.value).href);
        if(url.host==='preview'){const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==url.searchParams.get('sha256'))return new Response('Changed source',{status:404});return new Response(bytes,{headers:{'Content-Type':response.headers.get('content-type')??'application/octet-stream','Cache-Control':'no-store'}});}
        return response;
      }catch{return new Response('Not found',{status:404});}
}
async function readMedia(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const id = url.pathname.slice(1);
        if (switching || closing || url.host !== "asset" || !/^[a-f0-9-]{36}$/.test(id))
          return new Response("Not found", { status: 404 });
        const generation = coreGeneration;
        const r = await rpc("internal.locate", { id });
        if (!r.ok || generation !== coreGeneration || switching || closing) return new Response("Missing asset", { status: 404 });
        const { file, mime, bytes } = r.value;
        let start = 0,
          end = bytes - 1,
          status = 200;
        const range = request.headers.get("range");
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!m)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${bytes}` },
            });
          if (!m[1]) {
            start = Math.max(0, bytes - Number(m[2]));
          } else {
            start = Number(m[1]);
            if (m[2]) end = Math.min(end, Number(m[2]));
          }
          if (start > end || start >= bytes)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${bytes}` },
            });
          status = 206;
        }
        const headers: Record<string, string> = {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Cache-Control": "no-store",
        };
        if (status === 206)
          headers["Content-Range"] = `bytes ${start}-${end}/${bytes}`;
        return new Response(
          Readable.toWeb(fs.createReadStream(file, { start, end })) as any,
          { status, headers },
        );
      } catch {
        return new Response("Media unavailable", { status: 404 });
      }
}
async function createDesktopWindow() {
    if (window) return window;
    const nativeWindow = new BrowserWindow({
      width: 1440,
      height: 1000,
      minWidth: 1000,
      minHeight: 700,
      title: "Rainfall Studio",
      backgroundColor: "#101015",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window = nativeWindow;
    nativeWindow.removeMenu();
    nativeWindow.once('closed', () => { if (window === nativeWindow) window = undefined; });
    nativeWindow.on("close", (event) => {
      if (!closing && sessionRuntime.closeRequested()) event.preventDefault();
    });
    nativeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    nativeWindow.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("app://ui/")) e.preventDefault();
    });
    nativeWindow.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    await nativeWindow.loadURL("app://ui/index.html");
    return nativeWindow;
}
app
  .whenReady()
  .then(async () => {
    // The source launcher must serve its own build. The workspace lease still protects the shared library.
    if (!browserFresh && !app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    lease = await acquireWorkspaceLease(root);
    startCore();
    await ready;
    protocol.handle("app", (request) => {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname);
      const target = path.resolve(__dirname, "ui", "." + rel);
      const allowed = path.resolve(__dirname, "ui");
      if (url.host !== "ui" || !target.startsWith(allowed + path.sep))
        return new Response("Forbidden", { status: 403 });
      return net.fetch("file:///" + target.replace(/\\/g, "/"));
    });
    protocol.handle("material-cover", readMaterialCover);
    protocol.handle("media", readMedia);
    handlers();
    const runtimePreferences=path.join(root,'runtime-preferences.json');
    if(fs.existsSync(runtimePreferences)){
      try {
        const saved=JSON.parse(fs.readFileSync(runtimePreferences,'utf8'));
        if(typeof saved.backgroundEnabled==='boolean'&&typeof saved.loginAtStartup==='boolean')sessionRuntime.configure({backgroundEnabled:saved.backgroundEnabled,loginAtStartup:saved.loginAtStartup},true,!browserOnly);
      } catch { /* Preserve malformed preferences; open normally so the user can repair them. */ }
    }
    if (browserOnly) {
      const url = await openBrowserStudio(!browserNoOpen);
      if (browserNoOpen) console.log("RAINFALL_BROWSER_URL=" + url);
      else setTrayEnabled(true);
    } else {
      const nativeWindow = await createDesktopWindow();
      if (!process.argv.includes("--rainfall-background") || !sessionRuntime.status().backgroundEnabled) nativeWindow.show();
    }
  })
  .catch((err) => {
    console.error(err);
    app.exit(browserFresh && err instanceof Error && err.message === "WORKSPACE_ALREADY_OWNED" ? 73 : 1);
  });
let closing = false;
app.on("before-quit", (e) => {
  browserStudio?.close();
  publishWorkbench?.close();
  void tmeAiCloud.disconnect().catch(()=>{});
  tmeAiNative.interrupt();
  if (!closing && child) {
    e.preventDefault();
    closing = true;
    Promise.allSettled([rpc("internal.close"),puleJobs.close(),sunoCnJobs.close(),accountBrowsers.close(),fanqieAccounts.close(),remoteAssistServer.close()]).finally(() => {
      child.kill();
      app.quit();
    });
  }
});
app.on("window-all-closed", () => { if (!browserOnly) app.quit(); });
app.on("will-quit", () => {
  tray?.destroy();
  void lease?.release();
});
app.on("second-instance", (_event, commandLine) => {
  if (!lease || !browserHandlers.size || closing) return;
  if (commandLine.includes("--rainfall-browser")) {
    if (!offlineAcceptance) void openBrowserStudio().catch(() => undefined);
    return;
  }
  void createDesktopWindow().then(nativeWindow => {
    nativeWindow.show();
    nativeWindow.focus();
  }).catch(() => undefined);
});
