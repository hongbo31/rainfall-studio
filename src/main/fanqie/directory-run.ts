import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BrowserContext, Frame, Page } from "playwright-core";
import {
  assertFanqieDownloadTrack,
  type FanqieDownloadArchive, type FanqieDownloadScanDiagnostics, type FanqieDownloadScope, type FanqieDownloadTrack,
} from "../../core/fanqie-downloads";
import { digest } from "../../core/assets";
import { FanqieDownloadCleanupQueue, hasPendingFanqieCleanup } from "../../core/fanqie-download-cleanup";
import { songDownloadCollisionStem } from "../../core/download-filenames";
import { verifyFanqieMaterials } from "../../core/fanqie";
import type { FanqieAuthorizationPreference, FanqieInput } from "../../shared/fanqie";
import { checkFanqieNewUpload, fanqieTitleKey, type FanqieCatalog, type FanqieCatalogQuery, type FanqieCatalogRow } from "../../shared/fanqie-catalog";
import {
  defaultFanqieDirectoryPreferences, defaultFanqieDirectoryRelease, isFanqieDownloadActive,
  type FanqieDirectoryPreferences, type FanqieDownloadBatch, type FanqieDownloadBatchItem,
  type FanqieDownloadPreview, type FanqieDownloadSong, type FanqieSignatureStage,
} from "../../shared/fanqie-downloads";
import { scopedDirectory } from "../browser-accounts";
import { fanqieRosterNameKey } from "./artist-creation";
import { authorizeFanqieRecords } from "./authorize-records";
import { FanqieCatalogSession, fanqieCatalogError } from "./catalog-session";
import { fanqieHomeUrl, fanqieUploadFormUrl as formUrl } from "./directory-page";
import { executeFanqieDirectoryForm, type FanqieDirectorySong } from "./directory-form";
import { fanqieContractUrl, isFanqieAuthorizationPage, readFanqieSigningPage, type FanqieExistingSigningPage } from "./directory-signature";
import { FanqieDirectoryTrace, type FanqieDirectoryTracePort } from "./directory-trace";
import { prepareFanqieWorkMaterials } from "./materials";
import { recycleFanqieFile } from "./recycle-file";

export type FanqieDownloadBinding = { batchId:string; id:string; sourceIdentity:string; audioSha256:string; originalTitle?:string; promptEngine?:string };
export type FanqieUploadJob = {
  id:string; title:string; phase:"uploading"|"unknown"|"contract_pending"|"recorded";
  accountKey:string; recordingSha256:string; pending:string|null; updatedAt:string; uploadedAt?:string; reason?:string;
  officialRecord?:FanqieCatalogRow; archiveObservedAt?:string; input:FanqieInput; baselineIds:string[]; download?:FanqieDownloadBinding;
};

type Configuration = {
  authors:FanqieInput["authors"]; artistAuthors?:Record<string,FanqieInput["authors"]>;
  authorizationPreference?:FanqieAuthorizationPreference; directoryPreferences?:FanqieDirectoryPreferences;
};
type Round = {
  number:number; trackIds:string[]; mode?:FanqieAuthorizationPreference["mode"];
  signContract?:boolean; contractPrepared?:boolean; materialsRecycled?:true|"after_upload"; contractGenerationRequestedAt?:number;
};
type Journal = FanqieDownloadBatch & {
  accountKey:string; configurationHash:string; tracks?:FanqieDownloadTrack[];
  promptEngines?:Record<string,string>;
  archiveRoot?:string; active?:Round; requireSecurityVerification?:true;
};
type CatalogAccount = Awaited<ReturnType<FanqieCatalogSession["inspect"]>>;
type DirectorySingers = Awaited<ReturnType<FanqieCatalogSession["resolveDirectorySingers"]>>;
type SignatureScope = {id:string;round:number};
type WorkPage = {id:string;url:string;signing?:true};
type SignatureWatch = SignatureScope & {
  stage:FanqieSignatureStage;issue?:string;canContinue:()=>boolean;stop:()=>void;
  closeCompletedPopup:()=>Promise<void>;
};
export type FanqieDirectoryPlan = {
  id:string; accountKey?:string; configurationHash?:string;
  preferences?:FanqieDirectoryPreferences; prepareContract?:boolean;
};
export type FanqieDirectoryPlanAction = "start"|"observe"|"reconcile"|"cleanup";
type Options = {
  root:string; stateDirectory:string; session:FanqieCatalogSession;
  generation:()=>number; guard:(generation:number)=>void; configuration:()=>Configuration|null;
  downloads?:(scope?:FanqieDownloadScope)=>Promise<FanqieDownloadArchive>;
  jobs:()=>FanqieUploadJob[]; save:(job:FanqieUploadJob)=>void; archive:(job:FanqieUploadJob)=>void;
  materials?:typeof prepareFanqieWorkMaterials; verify?:typeof verifyFanqieMaterials;
  executeDirectoryForm?:typeof executeFanqieDirectoryForm; authorize?:typeof authorizeFanqieRecords;
  trashDownload?:(file:string)=>Promise<void>; openDiagnostics?:(folder:string)=>Promise<void>;
  autoResume?:(scope:SignatureScope,generation:number)=>Promise<boolean>;
  plan?:FanqieDirectoryPlan&{check:()=>Promise<void>};
};

const hash = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finalIntent = "first-step:confirm-upload";
const signingPopupLoadGraceMs = 5_000;
const contractGenerationTimeoutMs = 15 * 60_000;
const duplicateReasons = new Set(["FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS"]);
const pathKey = (file:string) => process.platform === "win32" ? file.toLowerCase() : file;
const failCode = (cause:unknown) => fanqieCatalogError(cause).code;
const cleanupFailed = "FANQIE_DOWNLOAD_CLEANUP_FAILED";
type ReconciliationDiagnostic = 'existing-audio-job'|'upload-editor-open'|'duplicate-audio-hash';
function reconciliationError(reason:ReconciliationDiagnostic) {
  return Object.assign(Error("FANQIE_RECONCILIATION_REQUIRED"),{fanqieDiagnosticReason:reason});
}

function titleQueries(title:string,originalTitle?:string):FanqieCatalogQuery[] {
  return originalTitle && originalTitle!==title ? [{title},{title:originalTitle}] : [{title}];
}

function signed(row:FanqieCatalogRow) {
  return row.stage==="reviewing"||row.stage==="published";
}

function pendingContractId(row:FanqieCatalogRow) {
  return row.stage==="contract_pending"&&row.contract?.state==="awaiting_signature"?row.contract.id:undefined;
}

function roundReceipts(journal:Journal,catalog:FanqieCatalog,allowGenerated:boolean) {
  if(!journal.active)return;
  const ids=new Set(journal.active.trackIds);
  if(ids.size!==journal.active.trackIds.length)return;
  const records=new Map(catalog.rows.map(row=>[row.id,row]));
  const items=journal.items.filter(item=>ids.has(item.id)&&item.state==="uploaded");
  if(items.length!==ids.size||!items.length)return;
  const pending=new Set<string>();
  for(const item of items){
    const row=item.workId?records.get(item.workId):undefined;
    if(row?.title!==item.title)return;
    if(signed(row))continue;
    const contractId=pendingContractId(row);
    if(!allowGenerated||!contractId)return;
    pending.add(contractId);
  }
  if(pending.size>1)return;
  return {fullySigned:pending.size===0};
}

export function checkFanqieUploadTitle(catalog:FanqieCatalog,title:string,originalTitle?:string,
  retryJob?:FanqieUploadJob) {
  let candidateCatalog=catalog;
  const saved=retryJob?.officialRecord;
  if(retryJob&&!retryJob.archiveObservedAt&&saved){
    const matching=catalog.rows.filter(row=>row.id===saved.id&&row.title===saved.title);
    if(matching.length===1)candidateCatalog={...catalog,rows:catalog.rows.filter(row=>row.id!==saved.id),total:catalog.total-1};
  }
  const primary = checkFanqieNewUpload(candidateCatalog,title);
  return primary.allowed && originalTitle ? checkFanqieNewUpload(candidateCatalog,originalTitle) : primary;
}

function publicSong({id,folder,audioName,title,singer,issue,release}:FanqieDownloadTrack):FanqieDownloadSong {
  return {id,folder,audioName,title,singer,issue,release};
}

function canRetryDownload(job:FanqieUploadJob,track:FanqieDownloadTrack) {
  return job.phase!=="uploading"&&!job.archiveObservedAt&&
    job.title===track.title&&job.download?.id===track.id&&job.download.originalTitle===track.originalTitle&&
    job.download.sourceIdentity===track.source?.audio.identity;
}

function hasOpenUploadEditor(context:BrowserContext) {
  return context.pages().some(page=>!page.isClosed()&&page.url().startsWith(formUrl));
}

export class FanqieDirectoryRun {
  private signatureWatch?:SignatureWatch;
  private directoryEditor?:SignatureScope&{page:Page;contractId?:string};
  private readonly workPages = new Map<Page,WorkPage>();
  private readonly cleanup:FanqieDownloadCleanupQueue<Journal>;
  private latestScanId?:string;
  constructor(private readonly options:Options) {
    this.cleanup=new FanqieDownloadCleanupQueue(options.stateDirectory);
  }

  private journalFile() {
    const plan=this.options.plan;
    return plan?path.join(this.runFolder(plan.id),"batch.json"):path.join(this.options.stateDirectory,"download-batch.json");
  }
  private read():Journal|null {
    const file=this.journalFile();
    return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):null;
  }
  private save(journal:Journal,file=this.journalFile()) {
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file+".tmp",JSON.stringify(journal,null,2));
    fs.renameSync(file+".tmp",file);
  }
  private runFolder(id:string) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id)) throw Error("FANQIE_JOB_NOT_FOUND");
    return scopedDirectory(this.options.stateDirectory,"download-runs",id);
  }
  private log(journal:Journal,number:number) {
    const folder=this.runFolder(journal.id);
    journal.hasDiagnostics=true;
    return new FanqieDirectoryTrace(folder,(label,error)=>this.options.session.mark(label,error)).round(number);
  }
  private scanLog(id:string) {
    this.latestScanId=id;
    return new FanqieDirectoryTrace(this.runFolder(id),(label,error)=>this.options.session.mark(label,error)).round(0);
  }
  private async recordScanStages(trace:FanqieDirectoryTracePort,diagnostics?:FanqieDownloadScanDiagnostics) {
    for(const stage of diagnostics?.stages??[]){
      await trace.trace(`directory:scan:${stage.step}`,stage.phase,undefined,undefined,
        stage.phase==="error"?Error(stage.code??"FANQIE_DOWNLOAD_SCAN_FAILED"):undefined,stage.counts);
    }
  }
  async showDiagnostics(scanOnly=false) {
    const journal=this.read();
    const id=scanOnly?this.latestScanId??this.options.plan?.id:journal?.hasDiagnostics?journal.id:this.latestScanId??this.options.plan?.id;
    if(!id||!this.options.openDiagnostics)throw Error("FANQIE_JOB_NOT_FOUND");
    const file=path.join(this.runFolder(id),"trace.jsonl");
    if(!fs.existsSync(file))throw Error("FANQIE_JOB_NOT_FOUND");
    await this.options.openDiagnostics(file);
    return true;
  }
  private signatureFor(journal:Journal) {
    const watch=this.signatureWatch;
    if(watch?.id===journal.id&&watch.round===journal.active?.number)return watch;
  }
  private publicBatch(journal:Journal,running=false):FanqieDownloadBatch {
    const {id,state,items,issue,preferences,round,hasDiagnostics,prepareContracts}=journal;
    const interrupted=state==="uploading"&&!running;
    const watch=state==="awaiting_signature"?this.signatureFor(journal):undefined;
    return {id,state:interrupted?"needs_review":state,items,issue:interrupted?"FANQIE_INTERRUPTED":watch?.issue??issue,
      preferences,round,remaining:items.filter(item=>item.state==="queued").length,hasDiagnostics,prepareContracts,
      signatureStage:watch?.stage,cleanupPending:hasPendingFanqieCleanup(this.options.stateDirectory,id)||undefined};
  }
  status(running:boolean) {
    const journal=this.read();
    return journal?this.publicBatch(journal,running):null;
  }
  private async scan(scope?:FanqieDownloadScope) {
    if(!this.options.downloads)throw Error("DOWNLOAD_ROOT_REQUIRED");
    return this.options.downloads(scope);
  }
  private async previewInputs(generation:number) {
    this.options.guard(generation);
    const diagnosticId=this.options.plan?.id??randomUUID();
    const trace=this.scanLog(diagnosticId);
    let archive:FanqieDownloadArchive,rootIssue:string|undefined;
    await trace.trace("directory:scan:core-response","begin");
    try {
      archive=await this.scan();
      await this.recordScanStages(trace,archive.scanDiagnostics);
      if(archive.scanDiagnostics?.failureCode)rootIssue=archive.scanDiagnostics.failureCode;
      await trace.trace("directory:scan:core-response","ok",undefined,undefined,undefined,
        {candidateCount:archive.items.length});
    }
    catch(error){
      const code=failCode(error);
      await trace.trace("directory:scan:core-response","error",undefined,undefined,error);
      if(!code.startsWith("DOWNLOAD_ROOT_")&&code!=="DOWNLOAD_FOLDER_UNAVAILABLE")throw error;
      rootIssue=code;
      archive={fingerprint:code,items:[]};
    }
    this.options.guard(generation);
    const config=this.options.configuration();
    const existing=new Map(this.options.jobs().filter(job=>job.download).map(job=>[job.download!.id,job]));
    const items=archive.items.map(track=>{
      const song=publicSong(track),job=existing.get(track.id);
      if(!song.issue&&track.source&&job?.download?.sourceIdentity===track.source.audio.identity&&!canRetryDownload(job,track))
        song.issue=job.officialRecord?"FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS":"FANQIE_RECONCILIATION_REQUIRED";
      return song;
    });
    const issueCounts=items.reduce<Record<string,number>>((counts,song)=>{
      if(song.issue)counts[song.issue]=(counts[song.issue]??0)+1;
      return counts;
    },{});
    await trace.trace("directory:scan:upload-history-filter","ok",undefined,undefined,undefined,
      {candidateCount:items.length,readyCount:items.filter(item=>!item.issue).length,issueCounts});
    const preferences=config?.directoryPreferences??defaultFanqieDirectoryPreferences;
    const journal=this.read();
    const preview:FanqieDownloadPreview={
      fingerprint:hash([archive.fingerprint,config,items]),items,rootIssue,batch:journal?this.publicBatch(journal):null,
      configurationRequired:!config?.authorizationPreference,limit:preferences.limit,signContract:preferences.signContract,hasDiagnostics:true,
    };
    return {archive,config,preview,previous:journal,diagnosticId};
  }
  async preview() {
    return (await this.previewInputs(this.options.generation())).preview;
  }
  async publish(request:{fingerprint:string;consent:true;limit?:number;signContract?:boolean;replaceBatchId?:string}) {
    const generation=this.options.generation();
    const inputs=await this.previewInputs(generation);
    const {preview,previous}=inputs;
    if(preview.rootIssue)throw Error(preview.rootIssue);
    if(request.fingerprint!==preview.fingerprint)throw Error("FANQIE_DOWNLOADS_CHANGED");
    if(request.replaceBatchId&&request.replaceBatchId!==previous?.id)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    const paused=previous&&previous.state!=="complete"?previous:undefined;
    if(paused&&!request.replaceBatchId)throw Error("FANQIE_RECONCILIATION_REQUIRED");
    if(isFanqieDownloadActive(preview.batch))throw Error("FANQIE_BROWSER_BUSY");
    const preferences={limit:request.limit??preview.limit,signContract:request.signContract??preview.signContract??true};
    return this.start(inputs,preferences,generation,paused);
  }
  async publishPlan(action:FanqieDirectoryPlanAction) {
    const plan=this.options.plan;
    if(!plan)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    const generation=this.options.generation();
    await this.checkPlan(generation);
    if(action==="cleanup")return this.retryPlanCleanup(plan,generation);
    // The run ID owns its journal. A restarted pump reads its receipts instead of starting another upload.
    const existing=this.status(false);
    if(existing)return action==="reconcile"&&existing.state!=="complete"?this.reconcile():existing;
    if(action!=="start")throw Error("FANQIE_JOB_NOT_FOUND");
    const inputs=await this.previewInputs(generation);
    if(inputs.preview.rootIssue)throw Error(inputs.preview.rootIssue);
    if(!inputs.config?.authorizationPreference)throw Error("FANQIE_CONFIGURATION_REQUIRED");
    if(plan.configurationHash&&hash(inputs.config)!==plan.configurationHash)throw Error("FANQIE_CONFIGURATION_CHANGED");
    await this.checkPlan(generation);
    const preferences=plan.preferences??inputs.config.directoryPreferences??defaultFanqieDirectoryPreferences;
    return this.start(inputs,{...preferences,signContract:plan.prepareContract??preferences.signContract},generation);
  }
  private async retryPlanCleanup(plan:FanqieDirectoryPlan,generation:number) {
    const journal=this.read();
    const active=journal?.active;
    if(!journal||!active?.trackIds.length||!journal.tracks||!journal.archiveRoot||!this.options.trashDownload||
      journal.id!==plan.id||journal.accountKey!==plan.accountKey||journal.configurationHash!==plan.configurationHash||
      journal.state!=="needs_review"||journal.issue!==cleanupFailed||plan.prepareContract!==false||
      journal.prepareContracts||journal.preferences?.signContract!==false||active.signContract===true)
      throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    if(active.materialsRecycled==="after_upload")return this.publicBatch(journal);
    if(hasPendingFanqieCleanup(this.options.stateDirectory,journal.id))return this.publicBatch(journal);
    const ids=new Set(journal.items.map(item=>item.id));
    if(!active.trackIds.every(id=>ids.has(id)))throw Error("FANQIE_SAVED_WORK_READBACK_REQUIRED");
    this.verifyCleanupReceipts(journal,journal.items);
    await this.recycleUploaded(journal,this.log(journal,active.number),generation,{legacy:true});
    return this.publicBatch(journal);
  }
  private verifyCleanupReceipts(journal:Journal,items:FanqieDownloadBatchItem[]) {
    const active=journal.active;
    if(!active?.trackIds.length||!journal.tracks||!journal.archiveRoot||!this.options.trashDownload)
      throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    const tracks=new Map(journal.tracks.map(track=>[track.id,track]));
    const itemIds=new Set(items.map(item=>item.id));
    const batchJobs=this.options.jobs().filter(job=>job.download?.batchId===journal.id);
    const jobs=items===journal.items?batchJobs:batchJobs.filter(job=>itemIds.has(job.download!.id));
    const receipts=new Map(jobs.map(job=>[job.download!.id,job]));
    const workIds=new Set(items.map(item=>item.workId));
    if(!items.length||itemIds.size!==items.length||workIds.size!==itemIds.size||
      receipts.size!==jobs.length||receipts.size!==itemIds.size||
      new Set(active.trackIds).size!==active.trackIds.length||
      !items.every(item=>{
        const job=receipts.get(item.id),source=tracks.get(item.id)?.source;
        return item.state==="uploaded"&&item.workId&&source&&job?.accountKey===journal.accountKey&&
          (item.archiveObserved===true||!!job.archiveObservedAt)&&
          (job.phase==="contract_pending"||job.phase==="recorded")&&job.pending===null&&
          job.title===item.title&&job.officialRecord?.title===item.title&&job.officialRecord.id===item.workId&&
          job.download?.sourceIdentity===source.audio.identity;
      }))throw Error("FANQIE_SAVED_WORK_READBACK_REQUIRED");
  }
  private markArchiveObserved(journal:Journal,trackIds:readonly string[]) {
    const observedAt=new Date().toISOString();
    const ids=new Set(trackIds);
    for(const item of journal.items)if(ids.has(item.id))item.archiveObserved=true;
    for(const job of this.options.jobs())if(job.download?.batchId===journal.id&&ids.has(job.download.id)){
      job.archiveObservedAt??=observedAt;
      this.options.save(job);
    }
    this.save(journal);
  }
  async pumpDownloadCleanup(now:number) {
    const generation=this.options.generation();
    const guard=()=>this.options.guard(generation);
    await this.cleanup.pump(now,guard,async({snapshot,files,legacy})=>{
      const active=snapshot.active;
      if(!active)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
      const items=snapshot.items.filter(item=>item.state==="uploaded"&&active.trackIds.includes(item.id));
      this.verifyCleanupReceipts(snapshot,items);
      const trace=new FanqieDirectoryTrace(this.runFolder(snapshot.id),()=>{}).round(active.number);
      const remaining=await this.recycleUploaded(snapshot,trace,generation,{files:new Set(files)});
      if(!remaining.length&&legacy){
        guard();
        const file=path.join(this.runFolder(snapshot.id),"batch.json");
        const current=fs.lstatSync(file,{throwIfNoEntry:false});
        if(current?.isFile()&&path.relative(file,fs.realpathSync.native(file))===""){
          const original:Journal=JSON.parse(fs.readFileSync(file,"utf8"));
          if(original.issue===cleanupFailed&&original.id===snapshot.id&&original.accountKey===snapshot.accountKey&&
            original.configurationHash===snapshot.configurationHash&&original.active?.number===active.number){
            original.active.materialsRecycled="after_upload";
            this.save(original,file);
          }
        }
      }
      return remaining;
    });
  }
  private async checkPlan(generation:number) {
    await this.options.plan?.check();
    this.options.guard(generation);
  }
  private async start({archive,config,preview,diagnosticId}:Awaited<ReturnType<FanqieDirectoryRun["previewInputs"]>>,
    preferences:FanqieDirectoryPreferences,generation:number,paused?:Journal) {
    if(!config?.authorizationPreference)throw Error("FANQIE_CONFIGURATION_REQUIRED");
    const songs=preview.items.filter(song=>!song.issue);
    const ids=new Set(songs.map(song=>song.id));
    const plan=this.options.plan;
    const journal:Journal={
      id:plan?.id??diagnosticId,state:"uploading",accountKey:plan?.accountKey??paused?.accountKey??"",
      configurationHash:hash(config),archiveRoot:archive.root,prepareContracts:true,
      requireSecurityVerification:true,
      tracks:archive.items.filter(track=>ids.has(track.id)),promptEngines:archive.promptEngines,preferences,
      items:songs.map(song=>({...song,state:"queued"})),
    };
    const trace=this.log(journal,0);
    const issueCounts=preview.items.reduce<Record<string,number>>((counts,song)=>{
      if(song.issue)counts[song.issue]=(counts[song.issue]??0)+1;
      return counts;
    },{});
    const scan={candidateCount:preview.items.length,readyCount:songs.length,batchLimit:preferences.limit,issueCounts,
      blockedItems:preview.items.flatMap(song=>song.issue?[{songTitle:song.title,issue:song.issue}]:[])};
    if(!songs.length){
      const error=Error(preview.items.length?"FANQIE_DOWNLOADS_NONE_READY":"FANQIE_DOWNLOADS_EMPTY");
      await trace.trace("directory:scan","error",undefined,undefined,error,scan);
      throw error;
    }
    if(paused)this.save(paused,scopedDirectory(this.options.stateDirectory,"download-history",paused.id+".json"));
    this.save(journal);
    this.signatureWatch?.stop();
    this.directoryEditor=undefined;
    this.workPages.clear();
    await trace.trace("directory:scan","ok",undefined,undefined,undefined,scan);
    await this.run(journal,config,generation);
    return this.publicBatch(journal);
  }
  private async connect(generation:number,trace:FanqieDirectoryTracePort) {
    const opened=!this.options.session.status().connected;
    if(opened)await this.options.session.ui("open",{},trace);
    this.options.guard(generation);
    return opened;
  }
  private rememberOpenedPage(journal:Journal,context:BrowserContext) {
    const page=context.pages().find(tab=>!tab.isClosed()&&tab.url()===fanqieHomeUrl);
    if(page)this.workPages.set(page,{id:journal.id,url:fanqieHomeUrl});
  }
  private checkCatalog(account:CatalogAccount,journal:Journal) {
    if(!account.catalog.complete||account.catalog.rows.length!==account.catalog.total)throw Error("FANQIE_CATALOG_INCOMPLETE");
    if(journal.accountKey&&account.report.accountKey!==journal.accountKey)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
  }
  private async run(journal:Journal,config:Configuration,generation:number) {
    const preferences=journal.preferences!;
    const prepareContracts=journal.prepareContracts||preferences.signContract;
    const guard=()=>this.options.guard(generation);
    const tracks=new Map(journal.tracks!.map(track=>[track.id,track]));
    let singers:DirectorySingers|undefined;
    while(journal.items.some(item=>item.state==="queued")) {
      const number=(journal.round??0)+1,trace=this.log(journal,number);
      journal.round=number;
      journal.state="uploading";
      this.save(journal);
      let editor:Page|undefined;
      let step="directory:connect";
      try {
        if(this.options.plan)await this.checkPlan(generation);
        await trace.trace(step,"begin");
        if(hash(this.options.configuration())!==journal.configurationHash)throw Error("FANQIE_CONFIGURATION_CHANGED");
        const opened=await this.connect(generation,trace);
        await trace.trace(step,"ok");
        step="directory:round";
        await trace.trace(step,"begin");
        const snapshot=await this.snapshot(journal);
        await this.options.session.run(async(context,sessionGuard)=>{
          if(opened)this.rememberOpenedPage(journal,context);
          const inspect=async(queries:readonly FanqieCatalogQuery[])=>{
            const account=await this.options.session.inspect(context,sessionGuard,false,trace,queries);
            guard();this.checkCatalog(account,journal);
            return account;
          };
          const queued=journal.items.filter(item=>item.state==="queued").map(item=>({item,track:tracks.get(item.id)!}));
          const queryCandidates=(start:number,end:number)=>queued.slice(start,end)
            .flatMap(({track})=>titleQueries(track.title,track.originalTitle));
          const existing=this.options.jobs();
          const retryFor=(track:FanqieDownloadTrack)=>existing.find(job=>canRetryDownload(job,track));
          let checkedThrough=preferences.limit;
          let observed=await inspect(queryCandidates(0,checkedThrough));
          const account=observed;
          journal.accountKey=account.report.accountKey;
          if(!singers){
            const names=[...new Set(queued.flatMap(({track})=>{
              const duplicate=checkFanqieUploadTitle(observed.catalog,track.title,track.originalTitle,retryFor(track));
              return !duplicate.allowed&&duplicateReasons.has(duplicate.reason)?[]:[fanqieRosterNameKey(track.singer)];
            }))];
            singers=names.length?await this.options.session.resolveDirectorySingers(context,()=>{
              sessionGuard();guard();
            },journal.accountKey,names,trace):new Map();
          }
          const staged:{item:FanqieDownloadBatchItem;track:FanqieDownloadTrack;input:FanqieDirectorySong;job:FanqieUploadJob}[]=[];
          const formTitles=new Set<string>();
          const sessionId=randomUUID();
          let roundMode:Round["mode"];
          for(const [index,{item,track}] of queued.entries()){
            if(staged.length===preferences.limit)break;
            const mode=track.release?.contractMode??config.authorizationPreference?.mode;
            if(prepareContracts&&roundMode&&roundMode!==mode)continue;
            const formTitle=track.formTitle??track.title;
            if(formTitles.has(formTitle))continue;
            if(index>=checkedThrough){
              checkedThrough=index+preferences.limit-staged.length;
              observed=await inspect(queryCandidates(index,checkedThrough));
            }
            const slot=staged.length;
            let failureStage:"catalog-title"|"artist-selection"|"source-verification"|"material-preparation"="catalog-title";
            await trace.trace("directory:materials","begin",undefined,slot,undefined,{songTitle:track.title});
            try {
              const retryJob=retryFor(track);
              const duplicate=checkFanqieUploadTitle(observed.catalog,track.title,track.originalTitle,retryJob);
              if(!duplicate.allowed)throw Error(duplicate.reason);
              failureStage="artist-selection";
              const singer=singers.get(fanqieRosterNameKey(track.singer));
              if(!singer)throw Error("FANQIE_ARTIST_SEARCH_UNVERIFIED");
              if("issue" in singer)throw Error(singer.issue);
              failureStage="source-verification";
              this.verifyTrack(track,snapshot.get(track.id));
              failureStage="material-preparation";
              const {input,audioSha256,previousRecord}=await this.prepare(track,config,account,journal,existing,sessionId,guard,context);
              input.singerArtistId=singer.artistId;
              const id=hash({account:journal.accountKey,audio:input.assets.audio.sha256});
              const job:FanqieUploadJob={
                id,title:track.title,phase:"uploading",pending:"opening-form",updatedAt:new Date().toISOString(),
                accountKey:journal.accountKey,recordingSha256:input.assets.audio.sha256,input,
                ...(previousRecord?{officialRecord:previousRecord}:{}),
                baselineIds:observed.catalog.rows.map(row=>row.id),
                download:{batchId:journal.id,id:track.id,sourceIdentity:track.source!.audio.identity,
                  audioSha256,originalTitle:track.originalTitle,promptEngine:journal.promptEngines?.[track.id]},
              };
              existing.push(job);
              roundMode=mode;
              formTitles.add(formTitle);
              staged.push({item,track,input,job});
              await trace.trace("directory:materials","ok",undefined,slot);
            }catch(error){
              item.issue=failCode(error);
              item.state=item.issue==="FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS"?"skipped":
                item.issue==="FANQIE_RECONCILIATION_REQUIRED"?"needs_review":"failed";
              if(item.state==="needs_review")journal.issue??=item.issue;
              await trace.trace("directory:materials","error",undefined,slot,error,
                {songTitle:track.title,failureStage,
                  failureReason:(error as {fanqieDiagnosticReason?:ReconciliationDiagnostic})?.fanqieDiagnosticReason});
            }
          }
          await trace.trace("directory:batch-selection","ok",undefined,undefined,undefined,
            {candidateCount:queued.length,batchLimit:preferences.limit,batchSize:staged.length});
          if(!staged.length){
            const review=journal.items.find(item=>item.state==="needs_review");
            if(review){journal.state="needs_review";journal.issue=review.issue??"FANQIE_RECONCILIATION_REQUIRED";this.save(journal);}
            return;
          }
          journal.active={number,trackIds:staged.map(entry=>entry.item.id),mode:roundMode,signContract:preferences.signContract};
          for(const {item} of staged){item.state="uploading";item.round=number;}
          this.save(journal);
          for(const {job} of staged)this.options.save(job);
          const activeStaged=()=>staged.filter(({item})=>journal.active?.trackIds.includes(item.id));
          let finalPreflight=false;
          const pending=async(checkpoint:string,index?:number)=>{
            sessionGuard();guard();
            if(checkpoint==="first-step:preflight"){
              if(hash(this.options.configuration())!==journal.configurationHash)throw Error("FANQIE_CONFIGURATION_CHANGED");
              const latest=await this.snapshot(journal);
              const currentStaged=activeStaged();
              if(!currentStaged.length)throw Error("FANQIE_ALL_SONGS_REJECTED");
              for(const {track,input} of currentStaged){
                this.verifyTrack(track,latest.get(track.id));
                await (this.options.verify??verifyFanqieMaterials)(input);
              }
              const fresh=await inspect(currentStaged.flatMap(({track})=>titleQueries(track.title,track.originalTitle)));
              if(fresh.accountId!==account.accountId)throw Error("FANQIE_CATALOG_SCOPE_CHANGED");
              for(const {track,job} of currentStaged){
                const duplicate=checkFanqieUploadTitle(fresh.catalog,track.title,track.originalTitle,job);
                if(!duplicate.allowed)throw Error(duplicate.reason);
              }
              for(const {job} of currentStaged)job.baselineIds=fresh.catalog.rows.map(row=>row.id);
              finalPreflight=true;
            }
            if(this.options.plan)await this.checkPlan(generation);
            if(checkpoint===finalIntent&&!finalPreflight)throw Error("FANQIE_UPLOAD_AUTHORIZATION_REQUIRED");
            for(const entry of index===undefined?activeStaged():[staged[index]]){
              if(!entry||!journal.active?.trackIds.includes(entry.item.id))throw Error("FANQIE_BATCH_SCOPE_CHANGED");
              assertFanqieDownloadTrack(entry.track);
              entry.job.pending=checkpoint;
              this.options.save(entry.job);
            }
            sessionGuard();guard();
          };
          step="directory:form";
          editor=await (this.options.executeDirectoryForm??executeFanqieDirectoryForm)(context,staged.map(entry=>entry.input),{
            guard:()=>{sessionGuard();guard();},
            checkStopped:this.options.plan?()=>this.checkPlan(generation):undefined,
            intent:pending,trace:trace.trace,watch:trace.watch,
            archiveObserved:async indexes=>{
              const ids=indexes.map(index=>{
                const entry=staged[index];
                if(!entry)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
                return entry.item.id;
              });
              this.markArchiveObserved(journal,ids);
            },
            verifyUnsubmitted:async index=>{
              const entry=staged[index];
              if(!entry||!journal.active?.trackIds.includes(entry.item.id))throw Error("FANQIE_BATCH_SCOPE_CHANGED");
              if(entry.item.archiveObserved||entry.item.workId||entry.job.archiveObservedAt)
                throw Error("FANQIE_SAVED_WORK_READBACK_REQUIRED");
              const account=await inspect(titleQueries(entry.track.title,entry.track.originalTitle));
              if(account.accountId!==entry.input.scope.accountId||account.report.accountKey!==journal.accountKey)
                throw Error("FANQIE_CATALOG_SCOPE_CHANGED");
              const titleKeys=new Set([entry.track.title,entry.track.originalTitle,entry.input.title]
                .filter((title):title is string=>!!title).map(fanqieTitleKey));
              const newMatches=account.catalog.rows.filter(row=>!entry.job.baselineIds.includes(row.id)&&
                titleKeys.has(fanqieTitleKey(row.title)));
              if(newMatches.length){
                await trace.trace("directory:submission-rejection:receipt-check","error",editor,index,
                  Error("FANQIE_SAVED_WORK_READBACK_REQUIRED"),{songTitle:entry.track.title,newRecordCount:newMatches.length});
                throw Error("FANQIE_SAVED_WORK_READBACK_REQUIRED");
              }
              await trace.trace("directory:submission-rejection:receipt-check","ok",editor,index,undefined,
                {songTitle:entry.track.title,newRecordCount:0});
            },
            rejectUnsubmittedSong:async index=>{
              const entry=staged[index];
              if(!entry)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
              await this.recycleRejectedSong(journal,entry.item.id,index,trace,generation);
            },
          });
          this.directoryEditor={id:journal.id,round:number,page:editor};
          // The editor is the exact Fanqie page used by this batch. Track it even
          // when the browser session was already open or the page left the home route.
          if(!editor.isClosed())this.workPages.set(editor,{id:journal.id,url:editor.url()});
          step="directory:receipts";
          await trace.trace(step,"begin",editor);
          const remainingStaged=staged.filter(({item})=>journal.active?.trackIds.includes(item.id));
          if(!remainingStaged.length)throw Error("FANQIE_ALL_SONGS_REJECTED");
          const after=await inspect(remainingStaged.map(({item})=>({title:item.title,waitForReceipt:true})));
          this.observeReceipts(journal,after,false);
          this.save(journal);
          const submittedCount=remainingStaged.filter(({item})=>item.state==="uploaded").length;
          const receiptsComplete=submittedCount===remainingStaged.length;
          if(receiptsComplete)await trace.trace(step,"ok",editor,undefined,undefined,{batchSize:remainingStaged.length,submittedCount});
          await this.recycleUploaded(journal,trace,generation,{page:editor});
          if(!receiptsComplete)throw Error("FANQIE_SAVED_WORK_READBACK_REQUIRED");
        });
        this.save(journal);
        if(journal.active){
          step="directory:contract";
          if(prepareContracts){
            if(await this.prepareContract(journal,config,generation,trace,{editor}))return;
          }else{
            await trace.trace("contract:skipped","ok",editor);
          }
          await this.finishRound(journal,generation,trace);
          journal.active=undefined;
          this.save(journal);
        }
        await trace.trace("directory:round","ok");
      }catch(error){
        const reason=failCode(error);
        journal.state="needs_review";journal.issue=reason;
        for(const item of journal.items){
          if(item.state!=="uploading")continue;
          item.state="needs_review";item.issue=reason;
        }
        for(const job of this.options.jobs()){
          if(job.download?.batchId===journal.id&&job.phase==="uploading")
            this.options.save({...job,phase:"unknown",reason});
        }
        this.save(journal);
        await trace.trace(step,"error",editor,undefined,error);
        return;
      }
    }
    await this.complete(journal,generation,this.log(journal,journal.round??0));
  }
  private async snapshot(journal:Journal) {
    const archive=await this.scan();
    if(journal.archiveRoot&&(!archive.root||pathKey(archive.root)!==pathKey(journal.archiveRoot)))throw Error("DOWNLOAD_ROOT_CHANGED");
    return new Map(archive.items.map(track=>[track.id,track]));
  }
  private verifyTrack(track:FanqieDownloadTrack,selected?:FanqieDownloadTrack) {
    assertFanqieDownloadTrack(track);
    if(!selected||hash(selected)!==hash(track))throw Error("FANQIE_DOWNLOADS_CHANGED");
  }
  private async recycleRejectedSong(journal:Journal,id:string,songIndex:number,trace:FanqieDirectoryTracePort,generation:number) {
    const active=journal.active;
    const item=journal.items.find(candidate=>candidate.id===id);
    const track=journal.tracks?.find(candidate=>candidate.id===id);
    const job=this.options.jobs().find(candidate=>candidate.download?.batchId===journal.id&&candidate.download?.id===id);
    const trash=this.options.trashDownload;
    if(!active||!active.trackIds.includes(id)||!item||item.state!=="uploading"||!track?.source||!journal.archiveRoot||!trash||
      !job||job.phase!=="uploading"||(job.pending!==finalIntent&&job.pending!=="first-step:submission-rejection:confirm-delete")||
      item.archiveObserved||item.workId||job.archiveObservedAt)
      throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    await trace.trace("directory:submission-rejection:recycle","begin",undefined,songIndex,undefined,{songTitle:item.title});
    try {
      const current=await this.scan();
      const root=path.resolve(journal.archiveRoot);
      if(!current.root||pathKey(root)!==pathKey(path.resolve(current.root)))throw Error("DOWNLOAD_ROOT_CHANGED");
      if(current.scanDiagnostics?.failureCode)throw Error("FANQIE_DOWNLOAD_SCAN_FAILED");
      this.verifyTrack(track,new Map(current.items.map(candidate=>[candidate.id,candidate])).get(id));
      const library=path.resolve(fs.realpathSync.native(this.options.root));
      const libraryPrefix=pathKey(library.endsWith(path.sep)?library:library+path.sep);
      const accountFolder=path.resolve(root,track.folder);
      const recordingFolder=path.resolve(path.dirname(track.source.audio.file));
      const relativeFolder=path.relative(accountFolder,recordingFolder);
      const collisionTitle=path.basename(relativeFolder)===relativeFolder?songDownloadCollisionStem(relativeFolder):undefined;
      const expectedFolder=relativeFolder===""||!!collisionTitle&&
        pathKey(collisionTitle.normalize("NFC"))===pathKey(path.parse(track.audioName).name.normalize("NFC"));
      if(pathKey(path.dirname(accountFolder))!==pathKey(root)||!expectedFolder)
        throw Error("FANQIE_RECYCLE_FILE_SCOPE");
      const protectedFiles=new Set<string>();
      for(const candidate of [...journal.tracks,...current.items]){
        if(candidate.id!==id){
          for(const file of candidate.relatedFiles??[])protectedFiles.add(pathKey(path.resolve(file)));
          for(const source of Object.values(candidate.source??{}))if(source)protectedFiles.add(pathKey(path.resolve(source.file)));
        }
        if(candidate.source?.proof)protectedFiles.add(pathKey(path.resolve(candidate.source.proof.file)));
      }
      const sources=[track.source.audio,track.source.lyrics,track.source.cover].filter((source):source is NonNullable<typeof source>=>!!source);
      const sourceKeys=sources.map(source=>pathKey(path.resolve(source.file)));
      if(new Set(sourceKeys).size!==sourceKeys.length)throw Error("FANQIE_RECYCLE_FILE_SCOPE");
      for(const source of sources){
        const candidate=path.resolve(source.file),key=pathKey(candidate),relative=path.relative(root,candidate);
        if(pathKey(path.dirname(candidate))!==pathKey(recordingFolder)||
          relative===""||relative.startsWith("..")||path.isAbsolute(relative)||
          candidate===library||key.startsWith(libraryPrefix)||protectedFiles.has(key))
          throw Error("FANQIE_RECYCLE_FILE_SCOPE");
      }
      for(const source of sources){
        this.options.guard(generation);
        await recycleFanqieFile(source,trash,()=>this.options.guard(generation));
        await trace.trace("directory:submission-rejection:recycle:"+
          (source===track.source.audio?"audio":source===track.source.lyrics?"lyrics":"cover"),
        "ok",undefined,songIndex,undefined,{songTitle:item.title});
      }
      item.state="failed";
      item.issue="FANQIE_SUBMISSION_VALIDATION_REJECTED";
      active.trackIds=active.trackIds.filter(trackId=>trackId!==id);
      this.save(journal);
      this.options.archive(job);
      await trace.trace("directory:submission-rejection:recycle","ok",undefined,songIndex,undefined,
        {songTitle:item.title,deletedMaterialCount:sources.length});
    }catch(error){
      await trace.trace("directory:submission-rejection:recycle","error",undefined,songIndex,error,{songTitle:item.title});
      throw Error("FANQIE_REJECTED_MATERIALS_CLEANUP_FAILED",{cause:error});
    }
  }
  private async prepare(track:FanqieDownloadTrack,config:Configuration,account:CatalogAccount,journal:Journal,
    existing:FanqieUploadJob[],sessionId:string,guard:()=>void,context:BrowserContext) {
    guard();
    const {audio,cover,lyrics,proof}=track.source!;
    const release=track.release??defaultFanqieDirectoryRelease;
    const formTitle=track.formTitle??track.title;
    if(release.proofRequired&&!proof)throw Error("FANQIE_DOWNLOAD_PROOF_REQUIRED");
    const audioSha256=digest(audio.file);
    const known=(sha256:string,except?:FanqieUploadJob)=>existing.find(job=>job!==except&&job.accountKey===account.report.accountKey&&
      (job.download?.audioSha256===sha256||job.recordingSha256===sha256));
    const prior=known(audioSha256);
    if(prior&&!canRetryDownload(prior,track))
      throw prior.officialRecord?Error("FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS"):reconciliationError('existing-audio-job');
    if(prior&&hasOpenUploadEditor(context))throw reconciliationError('upload-editor-open');
    const saved=track.artistId?config.artistAuthors?.[track.artistId]:undefined;
    const authors={
      lyricist:saved?.lyricist||track.credits?.lyricist||config.authors.lyricist,
      composer:saved?.composer||track.credits?.composer||config.authors.composer,
      singer:track.singer,
    };
    let lyricText="";
    if(lyrics){
      try { lyricText=new TextDecoder("utf-8",{fatal:true}).decode(fs.readFileSync(lyrics.file)); }
      catch { throw Error("FANQIE_LYRICS_INVALID"); }
      if(lyricText.includes("\0"))throw Error("FANQIE_LYRICS_INVALID");
      if(!lyricText.trim())lyricText="";
    }
    const assets=await (this.options.materials??prepareFanqieWorkMaterials)(this.options.root,{
      title:formTitle,audio:{...audio,sha256:audioSha256},cover:{...cover,sha256:digest(cover.file)},
      lyrics:lyricText,
    },guard,true);
    guard();assertFanqieDownloadTrack(track);
    const staged=(prior&&known(audioSha256,prior))??known(assets.audio.sha256,prior);
    if(staged)throw staged.officialRecord?Error("FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS"):reconciliationError('duplicate-audio-hash');
    const copyrightProof=proof?{file:proof.file,bytes:proof.bytes,sha256:digest(proof.file)}:undefined;
    // The journal scopes the configured credits locally. The upload form verifies each live selection.
    const input:FanqieDirectorySong={
      workId:"bundle:"+assets.audio.sha256,scope:{accountId:account.accountId,artistId:hash(authors),sessionId},
      title:formTitle,assets,authors,musicType:release.musicType,ai:release.ai,songAttribute:release.songAttribute,
      originalSinger:release.originalSinger,originalWorkId:release.originalWorkId,
      copyrightProof,rightsConfirmed:true,lyricsMatchConfirmed:true,
      coverAuthorization:release.musicType==="cover"?(copyrightProof?.sha256??"publisher-confirmation:"+journal.id):undefined,
    };
    await (this.options.verify??verifyFanqieMaterials)(input);
    guard();
    if(prior){
      if(hasOpenUploadEditor(context))throw reconciliationError('upload-editor-open');
      this.options.archive(prior);
      existing.splice(existing.indexOf(prior),1);
    }
    return {input,audioSha256,previousRecord:prior?.officialRecord};
  }
  private observeReceipts(journal:Journal,account:CatalogAccount,reconcile:boolean,editorOpen=false) {
    const ids=journal.active?new Set(journal.active.trackIds):undefined;
    const jobs=new Map(this.options.jobs().filter(job=>job.download?.batchId===journal.id).map(job=>[job.download!.id,job]));
    for(const item of journal.items){
      if(ids&&!ids.has(item.id))continue;
      const job=jobs.get(item.id);
      if(!job){
        if(item.state==="uploading"||item.state==="needs_review"){
          item.state="failed";item.issue="FANQIE_DOWNLOAD_UPLOAD_NOT_CONFIRMED";
        }
        continue;
      }
      if(job.accountKey!==journal.accountKey||job.input.scope.accountId!==account.accountId)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
      const titled=account.catalog.rows.filter(row=>row.title===job.title);
      const newRecords=job.pending===finalIntent?titled.filter(row=>!job.baselineIds.includes(row.id)):[];
      const savedRecord=job.officialRecord&&titled.find(row=>row.id===job.officialRecord!.id);
      const records=newRecords.length?newRecords:savedRecord?[savedRecord]:[];
      if(records.length!==1){
        if(reconcile&&!job.officialRecord&&job.pending&&job.pending!==finalIntent&&!editorOpen&&
          checkFanqieUploadTitle(account.catalog,job.title,job.download?.originalTitle).allowed){
          this.options.archive(job);
          item.state="failed";item.issue="FANQIE_DOWNLOAD_UPLOAD_NOT_CONFIRMED";
        }else{
          item.state="needs_review";item.issue="FANQIE_RECONCILIATION_REQUIRED";
        }
        continue;
      }
      const record=records[0];
      item.workId=record.id;item.officialStatus=record.officialStatus;
      if(record.stage==="unknown"||!reconcile&&record.stage!=="contract_pending"){
        item.state="needs_review";item.issue="FANQIE_CATALOG_STATUS_UNVERIFIED";
        continue;
      }
      this.options.save({...job,phase:record.stage==="contract_pending"?"contract_pending":"recorded",
        officialRecord:record,pending:null,reason:undefined});
      item.state="uploaded";item.issue=undefined;
    }
  }
  private async prepareContract(journal:Journal,config:Configuration|null,generation:number,trace:FanqieDirectoryTracePort,
    {editor,catalog}:{editor?:Page;catalog?:FanqieCatalog}={}) {
    const active=journal.active;
    const selected=journal.items.filter(item=>(!active||active.trackIds.includes(item.id))&&item.state==="uploaded"&&item.workId);
    const pending=selected.filter(item=>item.officialStatus==="待授权");
    if(!pending.length)return false;
    const resume=!!active&&!!catalog&&pending.every(item=>catalog.rows.some(row=>
      row.id===item.workId&&row.title===item.title&&row.contract));
    const watching=this.signatureFor(journal)?.canContinue();
    if((active?.contractPrepared||journal.state==="awaiting_signature")&&(!resume||watching)){
      if(active&&!watching&&!this.hasSignatureEvidence(journal,active))
        journal.issue??="FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED";
      journal.state="awaiting_signature";this.save(journal);
      return true;
    }
    const preference=config?.authorizationPreference;
    if(!preference||hash(config)!==journal.configurationHash)throw Error("FANQIE_CONFIGURATION_CHANGED");
    const ids=selected.map(item=>item.workId!);
    if(new Set(ids).size!==ids.length)throw Error("FANQIE_AUTHORIZATION_WORK_MISMATCH");
    const formTitles=editor&&new Map(journal.tracks?.map(track=>[track.id,track.formTitle]));
    const observe=(page:Page,signing?:FanqieExistingSigningPage,generationRequestedAt?:number)=>{
      if(!active)return;
      this.directoryEditor={id:journal.id,round:active.number,page,contractId:signing?.contractId};
      this.watchSignature(journal,active,page,trace,generation,signing,generationRequestedAt);
    };
    const verified=await (this.options.authorize??authorizeFanqieRecords)(this.options.root,this.options.session,journal.accountKey,
      ids,{...preference,mode:active?.mode??preference.mode},
      this.options.plan?()=>this.checkPlan(generation):()=>this.options.guard(generation),this.options.stateDirectory,true,
      {uploadedPage:editor,trace,resume,records:selected.map(item=>({id:item.workId!,title:item.title})),
        uploadedTitles:formTitles?selected.map(item=>formTitles.get(item.id)??item.title):undefined,
        directPreview:journal.requireSecurityVerification,onPreview:observe,
        beforeGenerate:active&&journal.requireSecurityVerification&&active.contractGenerationRequestedAt===undefined?async page=>{
          if(this.options.plan)await this.checkPlan(generation);
          this.options.guard(generation);
          active.contractGenerationRequestedAt=Date.now();
          active.contractPrepared=true;
          journal.state="awaiting_signature";
          this.save(journal);
          observe(page,undefined,active.contractGenerationRequestedAt);
        }:undefined,
      });
    if(!verified.some(row=>row.phase==="awaiting_signature"))return false;
    if(active)active.contractPrepared=true;
    journal.issue=undefined;
    journal.state="awaiting_signature";
    this.save(journal);
    return true;
  }
  async reconcile({afterSignature,continuation}:{
    afterSignature?:SignatureScope;
    continuation?:{batchId:string;preferences?:FanqieDirectoryPreferences};
  } = {}) {
    const generation=this.options.generation();
    this.options.guard(generation);
    if(this.options.plan)await this.checkPlan(generation);
    const journal=this.read();
    if(!journal)throw Error("FANQIE_JOB_NOT_FOUND");
    if(afterSignature&&(journal.id!==afterSignature.id||journal.active?.number!==afterSignature.round||
      journal.state!=="awaiting_signature"||!this.hasSignatureEvidence(journal,journal.active)))return this.publicBatch(journal);
    const config=this.options.configuration();
    const active=journal.active;
    const signActiveRound=active?.signContract??journal.preferences?.signContract??true;
    const prepareContracts=journal.prepareContracts||signActiveRound;
    if(continuation){
      if(continuation.batchId!==journal.id)throw Error("FANQIE_BATCH_SCOPE_CHANGED");
      if(continuation.preferences&&journal.tracks&&journal.items.some(item=>item.state==="queued")){
        if((journal.prepareContracts||continuation.preferences.signContract)&&!config?.authorizationPreference)
          throw Error("FANQIE_CONFIGURATION_REQUIRED");
        // Older rounds only recorded their signing choice in the run preferences.
        if(active)active.signContract=signActiveRound;
        journal.preferences=continuation.preferences;
        this.save(journal);
      }
    }
    const trace=this.log(journal,journal.active?.number??journal.round??0);
    let receiptsVerified=false;
    try {
      await trace.trace("directory:reconcile","begin");
      const opened=await this.connect(generation,trace);
      const activeIds=active&&new Set(active.trackIds);
      const queries:FanqieCatalogQuery[]=this.options.jobs().filter(job=>job.download?.batchId===journal.id&&
        (!activeIds||activeIds.has(job.download.id))).flatMap(job=>
        job.officialRecord ? [{title:job.title,id:job.officialRecord.id}] : titleQueries(job.title,job.download?.originalTitle));
      const account=await this.options.session.run(async(context,guard)=>{
        if(opened)this.rememberOpenedPage(journal,context);
        const current=await this.options.session.inspect(context,guard,false,trace,queries);
        this.options.guard(generation);this.checkCatalog(current,journal);
        if(afterSignature&&!roundReceipts(journal,current.catalog,!!journal.prepareContracts))return null;
        journal.accountKey=current.report.accountKey;
        this.observeReceipts(journal,current,true,hasOpenUploadEditor(context));
        return current;
      });
      if(!account)return this.publicBatch(journal);
      receiptsVerified=true;
      this.save(journal);
      await this.recycleUploaded(journal,trace,generation);
      const unresolved=journal.items.find(item=>item.state==="needs_review");
      const pendingContractIssue=journal.state==="awaiting_signature"?journal.issue:undefined;
      journal.issue=unresolved?.issue;
      if(unresolved){journal.state="needs_review";this.save(journal);return this.publicBatch(journal);}
      if(prepareContracts&&(!journal.tracks||active)){
        journal.issue=pendingContractIssue;
        if(journal.prepareContracts&&active&&this.hasSignatureEvidence(journal,active)){
          journal.state="awaiting_signature";
          const receipt=roundReceipts(journal,account.catalog,true);
          if(!receipt){this.save(journal);return this.publicBatch(journal);}
          journal.issue=undefined;
          if(signActiveRound&&!receipt.fullySigned){
            this.save(journal);
            if(!afterSignature&&!this.signatureFor(journal)?.canContinue())
              await this.prepareContract(journal,config,generation,trace,{catalog:account.catalog});
            return this.publicBatch(journal);
          }
          await trace.trace(receipt.fullySigned?"contract:signed-receipts":"contract:generated-receipts","ok");
        }else{
          if(await this.prepareContract(journal,config,generation,trace,{catalog:account.catalog}))return this.publicBatch(journal);
          journal.issue=undefined;
        }
      }
      await this.finishRound(journal,generation,trace);
      journal.active=undefined;
      await trace.trace("directory:reconcile","ok");
      if(journal.tracks&&journal.items.some(item=>item.state==="queued")){
        if(config&&hash(config)===journal.configurationHash)await this.run(journal,config,generation);
        else{
          const code="FANQIE_CONFIGURATION_CHANGED";
          journal.issue=code;
          for(const item of journal.items)if(item.state==="queued"){item.state="failed";item.issue=code;}
          journal.state="complete";
          await trace.trace("directory:next-round","error",undefined,undefined,Error(code));
        }
      }else{
        await this.complete(journal,generation,trace);
        return this.publicBatch(journal);
      }
    }catch(error){
      if(afterSignature&&!receiptsVerified){
        await trace.trace("directory:reconcile","error",undefined,undefined,error);
        return this.publicBatch(journal);
      }
      journal.state="needs_review";journal.issue=failCode(error);
      await trace.trace("directory:reconcile","error",undefined,undefined,error);
    }
    this.save(journal);
    return this.publicBatch(journal);
  }
  private async finishRound(journal:Journal,generation:number,trace:FanqieDirectoryTracePort) {
    const more=journal.items.some(item=>item.state==="queued");
    const watch=this.signatureFor(journal);
    if(more&&journal.prepareContracts&&journal.active?.signContract===false)await watch?.closeCompletedPopup();
    watch?.stop();
    const editor=this.directoryEditor;
    if(!editor||editor.id!==journal.id||editor.round!==journal.active?.number)return;
    this.directoryEditor=undefined;
    const {page,contractId}=editor;
    if(page.isClosed())return;
    if(contractId?page.url()!==fanqieContractUrl(contractId):!isFanqieAuthorizationPage(page))return;
    this.options.guard(generation);
    const url=page.url();
    this.workPages.set(page,{id:journal.id,url});
    if(!more)return;
    try {
      await trace.trace("directory:return-home","begin",page);
      this.options.guard(generation);
      if(page.isClosed()||page.url()!==url)throw Error("FANQIE_PAGE_SCOPE_CHANGED");
      await page.goto(fanqieHomeUrl,{waitUntil:"domcontentloaded",timeout:20_000});
      if(page.url()===fanqieHomeUrl)this.workPages.set(page,{id:journal.id,url:fanqieHomeUrl});
      await trace.trace("directory:return-home","ok",page);
    } catch(error) {
      await trace.trace("directory:return-home","error",page,undefined,error);
    }
  }
  private async complete(journal:Journal,generation:number,trace:FanqieDirectoryTracePort) {
    const review=journal.items.find(item=>item.state==="needs_review");
    journal.state=review?"needs_review":"complete";
    if(review)journal.issue??=review.issue??"FANQIE_RECONCILIATION_REQUIRED";
    this.save(journal);
    await trace.trace("directory:complete","ok");
    if(journal.active||journal.issue||journal.items.some(item=>item.state!=="uploaded"&&item.state!=="skipped"))return;

    const owned=new Map([...this.workPages].filter(([,owner])=>owner.id===journal.id));
    for(const page of owned.keys())this.workPages.delete(page);
    if(!owned.size||!this.options.session.status().connected)return;
    const matches=(page:Page)=>{
      const owner=owned.get(page);
      if(!owner||page.isClosed())return false;
      const url=page.url();
      return url===owner.url||!!owner.signing&&URL.canParse(url)&&new URL(url).origin===new URL(owner.url).origin;
    };
    let page:Page|undefined;
    try{
      await this.options.session.run(async(context,guard)=>{
        page=context.pages().find(matches);
        if(!page)return;
        await trace.trace("directory:close-window","begin",page);
        this.options.guard(generation);guard();
        const pages=context.pages().filter(tab=>!tab.isClosed());
        // Close the account window only when every open page belongs to this run.
        if(pages.length&&pages.every(matches))await context.close();
        else for(const tab of pages){
          this.options.guard(generation);guard();
          if(matches(tab))await tab.close();
        }
        await trace.trace("directory:close-window","ok");
      });
    }catch(error){
      // Closing the browser is independent of the already saved upload result.
      try{await trace.trace("directory:close-window","error",page,undefined,error);}catch{}
    }
  }
  private signatureFile(journal:Journal,active:Round) {
    return path.join(this.runFolder(journal.id),"verification-"+active.number+".json");
  }
  private signatureBinding(journal:Journal,active:Round) {
    const records=journal.items.filter(item=>active.trackIds.includes(item.id)&&item.state==="uploaded"&&item.workId)
      .map(item=>({id:item.workId!,title:item.title})).sort((a,b)=>a.id.localeCompare(b.id));
    if(!records.length||records.length!==active.trackIds.length||new Set(records.map(item=>item.id)).size!==records.length)
      return;
    return {id:journal.id,round:active.number,accountKey:journal.accountKey,receiptsHash:hash(records)};
  }
  private hasSignatureEvidence(journal:Journal,active:Round) {
    const binding=this.signatureBinding(journal,active);
    if(!binding)return false;
    try {
      const record=JSON.parse(fs.readFileSync(this.signatureFile(journal,active),"utf8"));
      return !!record&&typeof record.observedAt==="string"&&Number.isFinite(Date.parse(record.observedAt))&&
        (!journal.requireSecurityVerification||record.stage==="security_verification")&&
        Object.entries(binding).every(([key,value])=>record[key]===value);
    }catch{return false;}
  }
  /** Observe the user-operated signing page without reading verification fields. */
  private watchSignature(journal:Journal,active:Round,page:Page,trace:FanqieDirectoryTracePort,generation:number,
    signing?:FanqieExistingSigningPage,generationRequestedAt?:number) {
    const contractUrl=signing&&fanqieContractUrl(signing.contractId);
    const inScope=()=>!page.isClosed()&&(contractUrl?page.url()===contractUrl:isFanqieAuthorizationPage(page));
    if(!inScope())throw Error("FANQIE_AUTHORIZATION_SCOPE_CHANGED");
    this.signatureWatch?.stop();
    const binding=this.signatureBinding(journal,active);
    if(!binding)throw Error("FANQIE_AUTHORIZATION_WORK_MISMATCH");
    const popups=new Map<Page,{owned:Promise<boolean>;openedAt:number}>();
    let generationStarted=generationRequestedAt??(signing?Date.now():undefined);
    const onPopup=(popup:Page)=>{
      if((inScope()||generationStarted!==undefined)&&popup.context()===page.context())
        popups.set(popup,{owned:popup.opener().then(owner=>owner===page).catch(()=>false),openedAt:Date.now()});
    };
    page.on("popup",onPopup);
    if(signing)onPopup(signing.popup);
    const stopTrace=trace.watch(page);
    const signingTraces=new Map<Page,{url:string;detach:()=>void}>();
    let verifiedPopup:{page:Page;url:string}|undefined;
    let observed=this.hasSignatureEvidence(journal,active),busy=false,stopped=false,nextCheck=0,nextPlanCheck=0,sawGeneration=false;
    if(observed&&journal.requireSecurityVerification)this.markArchiveObserved(journal,active.trackIds);
    const verifiedStage=journal.prepareContracts&&active.signContract===false?"verify_generated_contract":"complete_signing";
    const watchSigningDocument=(popup:Page,url:string)=>{
      if(signingTraces.get(popup)?.url===url)return;
      signingTraces.get(popup)?.detach();
      const release=trace.watchSigningPage?.(popup,url);
      const detach=()=>{
        popup.off("framenavigated",onNavigation);
        release?.();
        signingTraces.delete(popup);
      };
      const onNavigation=(frame:Frame)=>{
        if(frame!==popup.mainFrame())return;
        if(verifiedPopup?.page===popup)verifiedPopup=undefined;
        detach();
      };
      popup.on("framenavigated",onNavigation);
      signingTraces.set(popup,{url,detach});
    };
    const stop=()=>{
      stopped=true;clearInterval(timer);page.off("popup",onPopup);stopTrace();
      for(const {detach} of signingTraces.values())detach();
      signingTraces.clear();
      if(this.signatureWatch===watch)this.signatureWatch=undefined;
    };
    const watch:SignatureWatch={id:journal.id,round:active.number,
      stage:observed?verifiedStage:signing?"open_existing_contract":generationRequestedAt!==undefined?"generating":"manual_confirmation",
      canContinue:()=>{
        if(stopped||watch.issue==="FANQIE_CONTRACT_LINK_NOT_READY")return false;
        if(!observed)return inScope()||generationStarted!==undefined;
        const existingLinkIsLoading=!!signing&&!signing.popup.isClosed()&&
          Date.now()-(generationStarted??0)<signingPopupLoadGraceMs;
        return !!verifiedPopup&&!verifiedPopup.page.isClosed()||existingLinkIsLoading;
      },
      closeCompletedPopup:async()=>{
        const popup=verifiedPopup?.page;
        if(popup&&!popup.isClosed()&&popup.url()===verifiedPopup?.url)await popup.close().catch(()=>undefined);
      },stop};
    const error=async (step:string,code:string,source=page)=>{
      if(watch.issue===code)return;
      watch.issue=code;
      await trace.trace(step,"error",source,undefined,Error(code));
    };
    const pause=async (step:string,code:string)=>{
      const current=this.read();
      if(current?.id===journal.id&&current.active?.number===active.number&&current.state==="awaiting_signature"){
        current.issue=code;
        this.save(current);
      }
      await error(step,code);
      stop();
    };
    const tick=async()=>{
      if(stopped||busy)return;
      busy=true;
      try {
        this.options.guard(generation);
        if(this.options.plan&&Date.now()>=nextPlanCheck){
          nextPlanCheck=Date.now()+12_000;
          await this.checkPlan(generation);
        }
        for(const popup of popups.keys())if(popup.isClosed()){
          popups.delete(popup);
          signingTraces.get(popup)?.detach();
          signingTraces.delete(popup);
        }
        const inspectPopups=async()=>{
          const candidates=await Promise.all([...popups].map(async ([popup,{owned,openedAt}])=>{
            if(!await owned||popup.isClosed())return {popup,url:"",stage:undefined,loading:false};
            const url=popup.url();
            const stage=await readFanqieSigningPage(popup);
            if(stage&&url===popup.url()&&!popup.isClosed())watchSigningDocument(popup,url);
            return {popup,url,stage:popup.url()===url?stage:undefined,loading:Date.now()-openedAt<signingPopupLoadGraceMs};
          }));
          return candidates;
        };
        if(!observed){
          if(generationStarted!==undefined&&Date.now()-generationStarted>=contractGenerationTimeoutMs){
            await pause("contract:generation","FANQIE_CONTRACT_GENERATION_TIMEOUT");
            return;
          }
          const ownsPage=inScope();
          const atPreview=ownsPage&&!signing;
          const visibleText=(text:string)=>page.getByText(text,{exact:true}).filter({visible:true}).count();
          const generating=atPreview&&await visibleText("合同生成中")>0;
          const handoff=atPreview&&await visibleText("已跳转签约页")===1;
          if((generating||handoff)&&generationStarted===undefined){
            generationStarted=Date.now();
            await trace.trace("contract:generation","begin",page);
          }
          if(generating){
            sawGeneration=true;
            watch.issue=undefined;
            watch.stage="generating";
          }else if(!generating&&handoff&&watch.stage!=="open_signing_page"){
            watch.stage="open_signing_page";
            await trace.trace("contract:generation","ok",page);
            await trace.trace("contract:verification-window","begin",page);
          }else if(atPreview&&!handoff&&sawGeneration&&watch.stage==="generating"&&await visibleText("确认签署")===1){
            watch.stage="manual_confirmation";
            generationStarted=undefined;
            sawGeneration=false;
            await error("contract:generation","FANQIE_CONTRACT_GENERATION_FAILED");
          }
          if(!generating){
            const candidates=await inspectPopups();
            const signing=candidates.filter(candidate=>candidate.stage==="security_verification"||
              !journal.requireSecurityVerification&&candidate.stage==="signing");
            const candidate=signing.length===1?signing[0]:undefined;
            const openPages=page.context().pages();
            if(candidate&&openPages.includes(page)&&candidate.popup!==page&&openPages.includes(candidate.popup)&&
              !page.isClosed()&&!candidate.popup.isClosed()&&candidate.popup.url()===candidate.url){
              this.options.guard(generation);
              if(stopped)return;
              const evidence=this.signatureFile(journal,active);
              if(!this.hasSignatureEvidence(journal,active))
                fs.writeFileSync(evidence,JSON.stringify({...binding,stage:candidate.stage,observedAt:new Date().toISOString()}),{flag:"wx"});
              if(candidate.stage==="security_verification")this.markArchiveObserved(journal,active.trackIds);
              observed=true;
              verifiedPopup={page:candidate.popup,url:candidate.url};
              this.workPages.set(candidate.popup,{id:journal.id,url:candidate.url,signing:true});
              watch.issue=undefined;
              if(watch.stage==="generating")await trace.trace("contract:generation","ok",page);
              watch.stage=verifiedStage;
              await trace.trace("contract:verification-window","ok",verifiedPopup.page);
            }else if(signing.length>1){
              await error("contract:verification-window","FANQIE_CONTRACT_VERIFICATION_AMBIGUOUS",signing[0].popup);
            }else if(!candidate){
              const direct=candidates.find(candidate=>candidate.stage==="signing");
              const unavailable=candidates.find(candidate=>candidate.stage==="link_not_ready");
              if(direct)await error("contract:verification-window","FANQIE_CONTRACT_VERIFICATION_REQUIRED",direct.popup);
              else if(unavailable)await error("contract:verification-window","FANQIE_CONTRACT_LINK_NOT_READY",unavailable.popup);
            }
            if(!observed&&!ownsPage&&generationStarted===undefined&&!candidates.some(candidate=>candidate.loading)){
              await pause("contract:preview-left",watch.issue??"FANQIE_CONTRACT_PREVIEW_LEFT");
              return;
            }
          }
        }
        else if(popups.size){
          const candidates=await inspectPopups();
          const current=candidates.find(candidate=>(candidate.stage==="signing"||candidate.stage==="security_verification")&&
            (!verifiedPopup||candidate.popup===verifiedPopup.page));
          if(current&&!stopped){
            verifiedPopup={page:current.popup,url:current.url};
            this.workPages.set(current.popup,{id:journal.id,url:current.url,signing:true});
          }
        }
        if(observed&&this.options.autoResume&&Date.now()>=nextCheck){
          nextCheck=Date.now()+12_000;
          if(await this.options.autoResume({id:journal.id,round:active.number},generation))stop();
        }
      }catch(error){
        try {
          await trace.trace("contract:verification-window","error",page,undefined,error);
        }catch{ /* The watcher also stops when diagnostics are unavailable. */ }
        finally{stop();}
      }
      finally{busy=false;}
    };
    const timer=setInterval(()=>void tick(),500);
    timer.unref();
    this.signatureWatch=watch;
    const step=signing?"contract:verification-window":generationRequestedAt!==undefined?"contract:generation":"contract:manual-confirmation";
    void Promise.resolve(trace.trace(step,"begin",page)).catch(()=>undefined);
  }
  private async recycleUploaded(journal:Journal,trace:FanqieDirectoryTracePort,generation:number,
    {page,files,legacy}:{page?:Page;files?:ReadonlySet<string>;legacy?:true}={}) {
    const active=journal.active;
    const trashDownload=this.options.trashDownload;
    if(!active||!journal.tracks||!journal.archiveRoot||!trashDownload)return [];
    // Older plan runs could record cleanup without a recycle-bin handler.
    if(!files&&(active.materialsRecycled==="after_upload"||active.materialsRecycled===true&&!this.options.plan))return [];
    const activeIds=new Set(active.trackIds);
    const batchJobs=new Map(this.options.jobs().filter(job=>job.download?.batchId===journal.id)
      .map(job=>[job.download!.id,job]));
    const archivedIds=new Set(journal.items.filter(item=>item.archiveObserved===true||
      !!batchJobs.get(item.id)?.archiveObservedAt).map(item=>item.id));
    const uploaded=journal.items.filter(item=>activeIds.has(item.id)&&archivedIds.has(item.id)&&item.state==="uploaded"&&item.workId);
    if(!uploaded.length)return [];
    if(new Set(uploaded.map(item=>item.workId)).size!==uploaded.length)
      throw Error("FANQIE_SAVED_WORK_READBACK_REQUIRED");
    await trace.trace("directory:recycle","begin");
    try {
      const current=await this.scan();
      const root=journal.archiveRoot;
      if(!current.root||pathKey(root)!==pathKey(current.root))throw Error("DOWNLOAD_ROOT_CHANGED");
      const library=pathKey(fs.realpathSync.native(this.options.root));
      const libraryPrefix=library.endsWith(path.sep)?library:library+path.sep;
      const accepted=new Set(uploaded.map(item=>item.id));
      const confirmedIds=new Set([...accepted,...journal.items.filter(item=>archivedIds.has(item.id)&&item.state==="uploaded"&&
        item.round!==undefined&&item.round<active.number).map(item=>item.id)]);
      const confirmed=new Map(journal.tracks.filter(track=>confirmedIds.has(track.id)).map(track=>[track.id,track]));
      const unfinished=[
        ...journal.tracks.filter(track=>!confirmedIds.has(track.id)),
        ...current.items.filter(track=>!track.source||track.source.audio.identity!==confirmed.get(track.id)?.source?.audio.identity),
      ];
      const remaining=new Set(unfinished.flatMap(track=>[
        ...(track.relatedFiles??[]),...Object.values(track.source??{}).map(source=>source?.file),
      ]).filter((file):file is string=>typeof file==="string").map(pathKey));
      for(const track of [...journal.tracks,...current.items])
        if(track.source?.proof)remaining.add(pathKey(track.source.proof.file));
      const ambiguousFolders=new Set(unfinished.filter(track=>!track.relatedFiles).map(track=>track.folder));
      const attempted=new Set<string>();
      const pending:string[]=[];
      let failed=false;
      const guard=()=>this.options.guard(generation);
      for(const track of journal.tracks){
        if(!accepted.has(track.id)||!track.source)continue;
        const songIndex=active.trackIds.indexOf(track.id);
        const accountFolder=path.join(root,track.folder);
        const recordingFolder=path.dirname(track.source.audio.file);
        const relativeFolder=path.relative(accountFolder,recordingFolder);
        const collisionTitle=path.basename(relativeFolder)===relativeFolder ? songDownloadCollisionStem(relativeFolder) : undefined;
        const expectedFolder=relativeFolder===""||!!collisionTitle&&
          pathKey(collisionTitle.normalize("NFC"))===pathKey(path.parse(track.audioName).name.normalize("NFC"));
        for(const [role,source] of Object.entries({audio:track.source.audio,lyrics:track.source.lyrics,cover:track.source.cover})){
          guard();
          if(!source)continue;
          const candidate=pathKey(source.file);
          if(attempted.has(candidate)||files&&!files.has(candidate))continue;
          attempted.add(candidate);
          if(remaining.has(candidate)||role!=="audio"&&ambiguousFolders.has(track.folder)){
            if(files)pending.push(candidate);
            continue;
          }
          try {
            if(pathKey(path.dirname(accountFolder))!==pathKey(root)||!expectedFolder||
              pathKey(path.dirname(source.file))!==pathKey(recordingFolder)||
              candidate.startsWith(libraryPrefix)||candidate===library)
              throw Error("FANQIE_RECYCLE_FILE_SCOPE");
            await recycleFanqieFile(source,trashDownload,guard,files?[]:undefined);
          }catch(error){
            guard();
            const reason=failCode(error);
            if(files||reason==="FANQIE_RECYCLE_OS_FAILED"||reason==="FANQIE_RECYCLE_FILE_CHECK_FAILED")pending.push(candidate);
            else failed=true;
            await trace.trace("directory:recycle:"+role,"error",undefined,songIndex,error);
          }
        }
      }
      if(failed||files&&attempted.size!==files.size)throw Error(cleanupFailed);
      guard();
      if(pending.length){
        if(!files)this.cleanup.defer(journal,pending,legacy);
        await trace.trace("directory:recycle:deferred","ok");
      }else if(!files&&accepted.size===activeIds.size){
        active.materialsRecycled="after_upload";
        this.save(journal);
      }
      if(!pending.length)await trace.trace("directory:recycle","ok");
      return pending;
    }catch(error){
      this.options.guard(generation);
      await trace.trace("directory:recycle","error",page,undefined,error);
      throw Error(cleanupFailed,{cause:error});
    }
  }

}
