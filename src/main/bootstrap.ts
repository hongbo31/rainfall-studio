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
import type { Mode } from "../shared/contracts";
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
import {FanqieCatalogSession, fanqieCatalogError} from './fanqie/catalog-session';
import {FanqieUploadBroker} from './fanqie/upload-broker';
import {createUnifiedPublishBroker,createTmeAiTransportProvider} from './tme/unified-publish';
import {externalReceiptBarrier,persistExternalReceiptBarrier,persistExternalReceiptStop} from './tme/external-receipt-barrier';
import {installNativeDiagnostics} from './native-diagnostics';
import {chooseInboxBridgeProject} from './inbox-bridge';
import {chooseDirectoryTaskSource} from './directory-tasks';
import {createProviderTextBroker} from './provider-text';
import {createMaterialWorkbenchBroker} from './material-workbench';
import {pathToFileURL} from 'node:url';
import {offlineAcceptanceEnabled,offlineAcceptanceInvocationAllowed} from '../shared/offline-acceptance';
const offlineAcceptance=offlineAcceptanceEnabled();
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
const root = resolveDataRoot(process.env.RAINFALL_DATA_ROOT,
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
let child: ReturnType<typeof utilityProcess.fork>;
let window: BrowserWindow;
let lease: Awaited<ReturnType<typeof acquireWorkspaceLease>> | undefined;
let tray: Tray | undefined;
const sessionRuntime = new SessionRuntime({
  show: () => {
    window?.show();
    window?.focus();
  },
  hide: () => window?.hide(),
  tray: (enabled) => {
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
  },
  login: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
  pause: () => {
    void rpc("internal.pauseAutomation").catch(() => undefined);
  },
  quit: () => app.quit(),
});
// Activation is intentionally unavailable in this build. No configure(true) call or OS registration.
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
const planModels=createPlanModelBroker({credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const liveMusic=createLiveMusicBroker({root,credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing});
const liveText=createLiveTextBroker({credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const productionTransport=new WindowsUiaTransport(path.join(__dirname,'tme-uia-host.ps1'));
const productionFlow=createProductionFlowBroker({credentials:apiCredentials,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,publication:blockedTmePublicationPort(productionTransport)});
const tmeAiNative=new TmeAiNativePort(path.join(__dirname,'tme-ai-uia-host.ps1'));
const tmeAiCloud=new TmeAiCloudSessionManager({enableExistingAlbum:true,available:()=>mode==='production'&&!switching&&!closing});
const accountIdentity=createAccountIdentityBroker({session:tmeAiCloud,rpc:(method,input)=>rpc(method,input),available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration});
const fanqieCatalog = new FanqieCatalogSession({root, available:()=>mode==='production'&&!switching&&!closing, generation:()=>coreGeneration});
const fanqieUpload = new FanqieUploadBroker({root,session:fanqieCatalog,available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,
  work:async selection=>{const result=await rpc('internal.fanqie.work',selection);if(!result.ok)throw Error(result.error.code);return result.value;},
  pickBundle:async()=>{const result=await dialog.showOpenDialog(window,{title:'选择番茄发布材料清单',properties:['openFile'],filters:[{name:'番茄发布材料清单',extensions:['json']}]});return result.canceled?null:result.filePaths[0];}});
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
const materialWorkbench=createMaterialWorkbenchBroker({credentials:apiCredentials,rpc,available:()=>mode==='production'&&!switching&&!closing,generation:()=>coreGeneration,chooseDirectory:()=>dialog.showOpenDialog(window,{title:'选择只读素材目录',properties:['openDirectory']})});
app.on('before-quit',()=>providerText.stop());
setInterval(()=>{if(offlineAcceptance)return;void productionFlow.pump();void unifiedPublish.pump();void providerText.pump().catch(()=>undefined);void materialWorkbench.pump().catch(()=>undefined);},2000).unref();
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }
>();
function startCore() {
  void tmeAiCloud.disconnect().catch(()=>{});
  coreGeneration++;
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
      if (window && !closing && !switching && restarts++ < 3) {
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
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
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
  suno: "https://suno.com",
  yourmusic: "https://app.yourmusic.fun/create",
  netease: "https://music.163.com/st/musician",
  qishui: "https://music.douyin.com/home",
  qqmusic: "https://y.tencentmusic.com/",
  kugou: "https://y.tencentmusic.com/",
  tme: "https://y.tencentmusic.com/",
  douyin: "https://creator.douyin.com/",
};
function handlers() {
  ipcMain.handle('rainfall:fanqie-upload',(event,action,input)=>safe(async()=>{
    trusted(event);
    try {return {ok:true,value:await fanqieUpload.ui(action,input)}}
    catch (error) {return {ok:false,error:fanqieCatalogError(error)}}
  }));
  ipcMain.handle('rainfall:fanqie-catalog',(event,action,input)=>safe(async()=>{
    trusted(event);
    try {return {ok:true,value:await fanqieCatalog.ui(action,input)}}
    catch (error) {return {ok:false,error:fanqieCatalogError(error)}}
  }));
    ipcMain.handle('rainfall:tme-ai-submission',(event,action,input)=>safe(async()=>{
      trusted(event);
      try{return{ok:true,value:await tmeAiSubmission.ui(action,input)}}catch(e){
        const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REQUEST_REJECTED';
        return{ok:false,error:{code,message:'腾讯 AI 检查未完成：'+code+'。'}};
      }
    }));
  ipcMain.handle('rainfall:tme-ai-prepare',(event,action,input)=>safe(async()=>{
    trusted(event);
    try{if(action==='connectBrowser')return{ok:true,value:await tmeAiCloud.connect(input)};if(action==='inspectBrowserAccount')return{ok:true,value:await tmeAiCloud.inspectAccount(input)};if(action==='fillIntakeFields')return{ok:true,value:await tmeAiCloud.fillIntakeFields(input)};if(action==='browserStatus')return{ok:true,value:tmeAiCloud.status()};if(action==='disconnectBrowser')return{ok:true,value:await tmeAiCloud.disconnect()};const value=await tmeAiPrepare.ui(action,input);if(['register','start','run','reconcile','resumePicker','resumeCrop'].includes(action))void unifiedPublish.pump();return{ok:true,value}}catch(e){
      const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REQUEST_REJECTED';
      return{ok:false,error:{code,message:'腾讯AI准备未完成：'+code+'。未知结果须只读核对，禁止重复上传；尚未接受条款或正式提交。'}};
    }
  }));
  ipcMain.handle('rainfall:production-flow',(event,action,input)=>safe(async()=>{
    trusted(event);
    try{return{ok:true,value:await productionFlow.ui(action,input)}}catch(e){
      const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REQUEST_REJECTED';
      return{ok:false,error:{code,message:'生产流程操作未完成：'+code+'。请查看本轮状态、配置和授权。'}};
    }
  }));
  ipcMain.handle('rainfall:live-music',(event,action,input)=>safe(async()=>{trusted(event);return{ok:true,value:await liveMusic.ui(action,input)}}));
  ipcMain.handle('rainfall:live-text',(event,action,input)=>safe(async()=>{
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
  const tmeScope=registerTmeBrowserHandlers((name,fn)=>ipcMain.handle(name,fn),trusted,tme,{mode:()=>mode,generation:()=>coreGeneration,unavailable:()=>switching||closing});
  checkTmeScope = tmeScope.assertScope;
  let checkLiveScope:()=>void=()=>{throw Error('WINDOW_BINDING_REQUIRED');};
  const liveRpc=async(action:string,input:Record<string,unknown>={})=>{checkLiveScope();const r=await rpc('internal.tme.live',{action,...input});if(!r.ok)throw Error(r.error.code);return r.value;};
  const liveManager=new TmeLiveManager({
    units:id=>liveRpc('units',{id}),batches:()=>liveRpc('batches'),
    get:async id=>{checkLiveScope();const r=await rpc('internal.tme.get',{id});if(!r.ok)throw Error(r.error.code);return r.value;},
    assertCurrent:async d=>{checkLiveScope();const r=await rpc('internal.tme.current',{id:d.id});if(!r.ok)throw Error(r.error.code);},
    updateUnit:(id,patch)=>liveRpc('updateUnit',{id,patch}),updateBatch:(id,patch)=>liveRpc('updateBatch',{id,patch}),claim:(id,identity)=>liveRpc('claim',{id,identity}),start:id=>liveRpc('start',{id}),
  },new WindowsUiaTransport(path.join(__dirname,'tme-uia-host.ps1')),os.hostname());
  const liveScope=registerTmeLiveHandlers((name,fn)=>ipcMain.handle(name,fn),trusted,liveManager,{mode:()=>mode,generation:()=>coreGeneration,unavailable:()=>switching||closing});
  checkLiveScope=liveScope.assertScope;
  interruptTme=()=>{void tmeAiCloud.disconnect().catch(()=>{});tmeScope.invalidate();liveScope.invalidate();tmeAiNative.interrupt();};
  app.on('before-quit',()=>liveManager.dispose());
  registerApiCredentialHandlers(
    (channel, handler) => ipcMain.handle(channel, handler),
    trusted,
    apiCredentials,
  );
  ipcMain.handle("rainfall:call", (e, method, input) =>
    safe(async () => {
      trusted(e);
      const parsed = validate(method, input);
        if(method.startsWith('materials.'))return{ok:true,value:await materialWorkbench.ui(method.slice('materials.'.length),parsed)};
      if(method.startsWith('accountIdentity.'))return accountIdentityUiResponse(()=>accountIdentity.ui(method.slice('accountIdentity.'.length),parsed));
      if(method==='directoryTasks.chooseDirectory')return chooseDirectoryTaskSource(parsed,{
        capture:()=>({mode,generation:coreGeneration,epoch:importEpoch,available:!switching&&!closing}),
        choose:()=>dialog.showOpenDialog(window,{title:'选择任务请求目录',properties:['openDirectory']}),rpc,
      });
      if(method==='inbox.bridge.chooseDirectory')return chooseInboxBridgeProject({
        capture:()=>({mode,generation:coreGeneration,epoch:importEpoch,available:!switching&&!closing}),
        choose:()=>dialog.showOpenDialog(window,{title:'选择专用 dot-delivery 项目目录（包含 incoming 和 receipts）',properties:['openDirectory']}),rpc,
      });
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
        const result = await rpc(method, parsed);
        if (result.ok&&!offlineAcceptance) void unifiedPublish.pump();
        return result;
      }
      return method === "apiProfile.save"
        ? apiCredentials.runExclusive(() => rpc(method, parsed))
        : rpc(method, parsed);
    }),
  );
  ipcMain.handle("rainfall:import", (e, role, workId, requestId) =>
    safe(async () => {
      trusted(e);
      if (
        ![
          "audio_A",
          "audio_B",
          "cover",
          "rights",
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
      const importGeneration=coreGeneration;
      const dialogEpoch=importEpoch;
      if(role.startsWith('coverResult')&&(!workId||typeof requestId!=='string'||!/^[a-f0-9-]{36}$/.test(requestId)))throw Error('COVER_REQUEST_REQUIRED');
      const r = await dialog.showOpenDialog(window, {
        title: role === "backup" ? "选择备份恢复" : "导入本地文件",
        properties: ["openFile"],
      });
      if (r.canceled) return { ok: true, value: null };
      if(importGeneration!==coreGeneration||dialogEpoch!==importEpoch||switching||closing)throw Error('WORKSPACE_CHANGED');
      if (role === "legacy") {
        const preview = await rpc("internal.previewLegacy", {
          source: r.filePaths[0],
        });
        if (!preview.ok) return preview;
        const confirmation = await dialog.showMessageBox(window, {
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
        ? apiCredentials.runExclusive(async()=>{if(tmeScope.isBusy()||liveScope.isBusy())throw Error('TME_BUSY');tmeScope.invalidate();liveScope.invalidate();importEpoch++;switching=true;try{await tmeAiCloud.disconnect();return await performImport()}finally{switching=false}})
        : performImport();
    }),
  );
  ipcMain.handle("rainfall:export", (e, kind, input) =>
    safe(async () => {
      trusted(e);
      if (
        !["backup", "materials", "coverTask", "coverRequest", "cover", "diagnostics"].includes(
          kind,
        )
      )
        throw Error("KIND");
      const ext =
        kind === "backup"
          ? "rainfall-backup.zip"
          : kind === "materials"
            ? "zip"
            : kind === "coverRequest" ? "json" : kind === "cover"
              ? "png"
              : "txt";
      const r = await dialog.showSaveDialog(window, {
        defaultPath: `Rainfall-${kind}-${Date.now()}.${ext}`,
      });
      if (r.canceled) return { ok: true, value: null };
      return rpc("internal.export", { kind, input, destination: r.filePath });
    }),
  );
  ipcMain.handle("rainfall:mode", (e, next) =>
    safe(() =>
      apiCredentials.runExclusive(async () => {
        trusted(e);
        if (!["production", "simulation"].includes(next)) throw Error("MODE");
          if(tmeScope.isBusy()||liveScope.isBusy())throw Error('TME_BUSY');
          tmeScope.invalidate();
          liveScope.invalidate();
        switching = true;
        tmeAiNative.interrupt();
        await tmeAiCloud.disconnect();
        try {
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
  ipcMain.handle("rainfall:official", (e, provider) =>
    safe(async () => {
      trusted(e);
      if (!official[provider]) throw Error("PROVIDER");
      await shell.openExternal(official[provider]);
      return { ok: true, value: true };
    }),
  );
}
app
  .whenReady()
  .then(async () => {
    if (!app.requestSingleInstanceLock()) {
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
    protocol.handle('material-cover',async request=>{
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
    });
    protocol.handle("media", async (request) => {
      try {
        const url = new URL(request.url);
        const id = url.pathname.slice(1);
        if (url.host !== "asset" || !/^[a-f0-9-]{36}$/.test(id))
          return new Response("Not found", { status: 404 });
        const r = await rpc("internal.locate", { id });
        if (!r.ok) return new Response("Missing asset", { status: 404 });
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
    });
    window = new BrowserWindow({
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
    window.removeMenu();
    window.on("close", (event) => {
      if (!closing && sessionRuntime.closeRequested()) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("app://ui/")) e.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    handlers();
    await window.loadURL("app://ui/index.html");
    window.show();
  })
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });
let closing = false;
app.on("before-quit", (e) => {
  void tmeAiCloud.disconnect().catch(()=>{});
  tmeAiNative.interrupt();
  if (!closing && child) {
    e.preventDefault();
    closing = true;
    rpc("internal.close").finally(() => {
      child.kill();
      app.quit();
    });
  }
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  tray?.destroy();
  void lease?.release();
});
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
