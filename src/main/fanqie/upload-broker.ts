import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {BrowserContext} from 'playwright-core';
import {digest} from '../../core/assets';
import {verifyFanqieMaterials} from '../../core/fanqie';
import {fanqieRoles,type FanqieInput,type FanqieAsset,type FanqieRole,type FanqieAssets} from '../../shared/fanqie';
import {checkFanqieNewUpload,type FanqieCatalogRow} from '../../shared/fanqie-catalog';
import {FanqieCatalogSession, fanqieCatalogError} from './catalog-session';
import {executeFanqieNativeUpload} from './native-upload';
import {FanqieWorkSelection,type FanqieWorkSource} from '../../core/fanqie-work';
import type {FanqieDownloadArchive,FanqieDownloadScope} from '../../core/fanqie-downloads';
import {fanqieDirectoryPreferencesSchema} from '../../shared/fanqie-downloads';
import {FanqieDirectoryRun,checkFanqieUploadTitle as checkUploadTitle,type FanqieDirectoryPlan,type FanqieDirectoryPlanAction,type FanqieDownloadBinding,type FanqieUploadJob} from './directory-run';
import type {executeFanqieDirectoryForm} from './directory-form';
import {prepareFanqieWorkMaterials} from './materials';
import {FanqieBatch,type BatchItem} from './batch';
import {authorizeFanqieRecords} from './authorize-records';
import type {FanqieArtistPage} from './artist-creation';

const name = z.string().trim().min(1).max(40);
const localName = z.string().min(1).max(200).refine(v => !/[\\/:\x00]/.test(v) && !['.','..'].includes(v), 'Relative basename required');
export const FanqieBundleSchema = z.strictObject({version:z.literal(1), title:name, ai:z.boolean(), musicType:z.literal('original'),
  authors:z.strictObject({lyricist:name,composer:name,singer:name}), files:z.strictObject({audio:localName,lyrics:localName,cover:localName})});
type WorkBinding = FanqieWorkSelection & {fingerprint:string;artistId?:string};
const ConfigurationSchema=z.strictObject({
  version:z.literal(1),
  authors:FanqieBundleSchema.shape.authors,
  useWorkMaterials:z.literal(true),
  publicationConsent:z.literal(true),
  authorizationPreference:z.strictObject({
    mode:z.enum(['exclusive','nonexclusive']),
    platforms:z.array(z.enum(['fanqie_music','fanqie_audio'])).min(1).max(2)
      .refine(v=>new Set(v).size===v.length&&v.includes('fanqie_music')),
    confirmContractManually:z.literal(true),
  }).optional(),
  artistAuthors:z.record(z.uuid(),FanqieBundleSchema.shape.authors).optional(),
  directoryPreferences:fanqieDirectoryPreferencesSchema.optional(),
});
type Job = FanqieUploadJob;
type Bundle = Omit<z.infer<typeof FanqieBundleSchema>, 'files'> & {assets: FanqieAssets;source?:WorkBinding;instrumental?:true;download?:FanqieDownloadBinding};
type BatchUploadResult={result?:{uploaded?:boolean;officialRecord?:FanqieCatalogRow}};
const scopedHash=z.string().regex(/^[a-f0-9]{64}$/);
const scheduledBatchInput=z.strictObject({runId:z.uuid(),accountKey:scopedHash,configurationHash:scopedHash,prepareContract:z.boolean().optional(),
  items:z.array(FanqieWorkSelection.extend({fingerprint:scopedHash})).min(1).max(20)
    .refine(items=>new Set(items.map(item=>item.workId)).size===items.length)});
type ScheduledBatch=z.infer<typeof scheduledBatchInput>;
type Options = {root:string;stateDirectory?:string;session:FanqieCatalogSession;available:()=>boolean;generation:()=>number;pickBundle:()=>Promise<string|null>;
  work?:(selection:FanqieWorkSelection)=>Promise<FanqieWorkSource>;
  downloads?:(scope?:FanqieDownloadScope)=>Promise<FanqieDownloadArchive>;
  materials?:typeof prepareFanqieWorkMaterials;verify?:typeof verifyFanqieMaterials;execute?:typeof executeFanqieNativeUpload;
  authorize?:typeof authorizeFanqieRecords;executeDirectoryForm?:typeof executeFanqieDirectoryForm;
  trashDownload?:(file:string)=>Promise<void>;openDiagnostics?:(folder:string)=>Promise<void>};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameAuthorization=(left:FanqieInput['authorizationPreference'],right:FanqieInput['authorizationPreference'])=>
  !!left&&!!right&&left.mode===right.mode&&left.confirmContractManually===right.confirmContractManually&&
  left.platforms.length===right.platforms.length&&left.platforms.every(platform=>right.platforms.includes(platform));
const empty = z.strictObject({});
const continueDownloads = z.strictObject({batchId:z.uuid(),preferences:fanqieDirectoryPreferencesSchema.optional()});
export function loadFanqieBundle(file: string): Bundle {
  if (!path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 65536) throw Error('FANQIE_BUNDLE_INVALID');
  const raw = FanqieBundleSchema.parse(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
  const folder = fs.realpathSync(path.dirname(file));
  const assets = {} as Record<FanqieRole,FanqieAsset>;
  for (const role of ['audio','lyrics','cover'] as const) {
    const target = path.join(folder,raw.files[role]);
    if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile() || path.dirname(fs.realpathSync(target)) !== folder) throw Error('FANQIE_BUNDLE_INVALID');
    assets[role] = {file:target,bytes:fs.statSync(target).size,sha256:digest(target)};
  }
  const {files,...metadata} = raw; return {...metadata, assets};
}
function publicBundle(bundle?: Bundle) {
  if (!bundle) return null;
  const {assets,...metadata} = bundle;
  return {...metadata,files:Object.fromEntries(Object.entries(assets).map(([role,asset])=>[role,{name:path.basename(asset.file),bytes:asset.bytes}]))};
}
function publicJob(job: Job) {
  const {input,baselineIds,download,...visible} = job; return {...visible,workId:input?.workId};
}
const isRecoverableTransfer = (job: Job) => ['FANQIE_UPLOAD_READBACK_TIMEOUT','FANQIE_BROWSER_TIMEOUT'].includes(job.reason ?? '') &&
  ['upload:audio','upload:lyrics','upload:cover','confirm-square-crop'].includes(job.pending ?? '');
const hasUploadEditor = (context: BrowserContext) => context.pages().some(page => !page.isClosed() && page.url().startsWith(
  'https://www.novelfm.com/creator/music/finished/ugc/uploadProduct',
));
/** Main owns paths, checked account/artist IDs, one-use grants and durable operation intents. */
export class FanqieUploadBroker {
  private bundle?: Bundle;
  private prepared?: {token:string;expires:number;generation:number;input:FanqieInput;artists:unknown;accountKey:string;fingerprint:string;source?:WorkBinding;download?:FanqieDownloadBinding};
  private localBusy = false;
  private pipelineBusy = false;
  private batchBusy = false;
  private directoryBusy = false;
  private batchAccountKey?:string;
  private readonly batch:FanqieBatch;
  private readonly directory:FanqieDirectoryRun;
  private readonly planDirectories=new Map<string,{generation:number;runner:FanqieDirectoryRun}>();
  private result: unknown = null;
  async withArtistCreation<T>(action: (scope: FanqieArtistPage) => Promise<T>) {
    if(this.batchBusy||this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    this.batchBusy=true;
    try { return await this.options.session.withArtistCreationPage(action); }
    finally { this.batchBusy=false; }
  }
  constructor(private readonly options: Options) {
    this.batch=new FanqieBatch(options.root, this.stateDirectory());
    this.directory=this.createDirectory();
    for (const job of this.jobs()) if (job.phase === 'uploading') this.save({...job,phase:'unknown',reason:'FANQIE_INTERRUPTED'});
  }
  private createDirectory(plan?:FanqieDirectoryPlan&{check:()=>Promise<void>}) {
    const directory=new FanqieDirectoryRun({...this.options,stateDirectory:this.stateDirectory(),
      ...(plan?{plan}:{}),
      configuration:()=>this.configuration(),guard:generation=>this.guard(generation),
      jobs:()=>this.jobs(),save:job=>this.save(job),archive:job=>this.archive(job),
      autoResume:async(scope,generation)=>{
        this.guard(generation);
        if(!this.options.session.status().connected)return true;
        if(this.batchBusy||this.localBusy||this.pipelineBusy)return false;
        const status=await this.runDirectory(()=>directory.reconcile({afterSignature:scope}));
        if(plan&&status.state==="complete")this.planDirectories.delete(plan.id);
        return status.id!==scope.id||status.round!==scope.round||status.state!=='awaiting_signature';
      }});
    return directory;
  }
  async publishPlanDirectory(plan:FanqieDirectoryPlan,action:FanqieDirectoryPlanAction,check:()=>Promise<void>) {
    return this.runDirectory(async()=>{
      const generation=this.options.generation();
      const saved=this.planDirectories.get(plan.id);
      const runner=saved?.generation===generation?saved.runner:this.createDirectory({...plan,check});
      const result=await runner.publishPlan(action);
      if(result.state==="awaiting_signature")this.planDirectories.set(plan.id,{generation,runner});
      else this.planDirectories.delete(plan.id);
      return result;
    });
  }
  async pumpDownloadCleanup(now=Date.now()) {
    await this.runDirectory(()=>this.directory.pumpDownloadCleanup(now));
  }
  async resolveWorkflowAccount() {
    const generation=this.options.generation();
    this.guard(generation);
    if(this.batchBusy||this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    const configuration=this.configuration();
    if(!configuration)throw Error('FANQIE_CONFIGURATION_REQUIRED');
    const configurationHash=sha(configuration),catalog=this.options.session;
    let profile=catalog.status().profile;
    if(!profile){
      try{profile=(await catalog.ui('syncProfile'))?.profile??null;}
      catch(error){
        if(await catalog.loginState()==='expired')throw Error('FANQIE_LOGIN_REQUIRED');
        throw error;
      }
    }
    this.guard(generation);
    if(sha(this.configuration())!==configurationHash)throw Error('FANQIE_CONFIGURATION_CHANGED');
    if(!profile)throw Error('FANQIE_ACCOUNT_ID_UNVERIFIED');
    return {accountKey:profile.accountKey,configurationHash};
  }
  private stateDirectory() {return this.options.stateDirectory??path.join(this.options.root,'production','fanqie');}
  private folder() {return path.join(this.stateDirectory(),'uploads');}
  private scheduledScope?:{accountKey:string;fingerprint:string;prepareContract?:boolean};
  private scheduledCheck?:()=>Promise<void>;
  async publishScheduled(raw:unknown,check?:()=>Promise<void>){
    const input=FanqieWorkSelection.extend({accountKey:scopedHash,configurationHash:scopedHash,fingerprint:scopedHash,prepareContract:z.boolean().optional()}).parse(raw);
    if(this.batchBusy||this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    const configuration=this.configuration();
    if(!configuration||createHash('sha256').update(JSON.stringify(configuration)).digest('hex')!==input.configurationHash)throw Error('FANQIE_CONFIGURATION_CHANGED');
    this.batchBusy=true;this.scheduledScope=input;this.scheduledCheck=check;
    const {workId,variant,useVersionMetadata}=input;
    try{return await this.publishConfigured({workId,variant,useVersionMetadata},input.prepareContract!==false);}
    finally{this.batchBusy=false;this.scheduledScope=undefined;this.scheduledCheck=undefined;}
  }
  async publishScheduledBatch(raw:unknown,check:(workId?:string)=>Promise<void>){
    const input=scheduledBatchInput.parse(raw);
    const queue=new FanqieBatch(this.options.root,path.join(this.stateDirectory(),'scheduled',input.runId));
    const items=input.items.map(({workId,variant})=>({workId,variant}));
    return this.runBatch(queue,items,!!queue.read(),{...input,check});
  }
  private jobs(): Job[] {
    if (!fs.existsSync(this.folder())) return [];
    return fs.readdirSync(this.folder()).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(this.folder(),f),'utf8')));
  }
  private save(job: Job) {
    fs.mkdirSync(this.folder(),{recursive:true}); const target = path.join(this.folder(),job.id+'.json');
    fs.writeFileSync(target+'.tmp',JSON.stringify({...job,updatedAt:new Date().toISOString()},null,2)); fs.renameSync(target+'.tmp',target);
  }
  private archive(job: Job) {
    const archive=path.join(this.folder(),'opening-history');
    fs.mkdirSync(archive,{recursive:true});
    fs.renameSync(path.join(this.folder(),job.id+'.json'),path.join(archive,job.id+'-'+randomUUID()+'.json'));
  }
  private recoverClosedEditor(job: Job, bundle: Bundle, current: Awaited<ReturnType<FanqieCatalogSession['inspect']>>, context: BrowserContext) {
    // These transfer checkpoints precede the durable confirmation intent.
    // Recovery requires the same materials and a closed original editor.
    if (job.phase !== 'unknown' || !isRecoverableTransfer(job) ||
        job.officialRecord || job.input.workId !== bundle.source?.workId ||
        job.title !== bundle.title || job.input.ai !== bundle.ai ||
        sha(job.input.authors) !== sha(bundle.authors) ||
        job.input.instrumental!==bundle.instrumental||
        fanqieRoles(bundle.instrumental).some(role => job.input.assets[role]?.sha256 !== bundle.assets[role]?.sha256))
      return false;
    if (current.accountId !== job.input.scope.accountId) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
    const duplicate = checkFanqieNewUpload(current.catalog, job.title);
    if (!duplicate.allowed) return false;
    if (hasUploadEditor(context)) throw Error('FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION');
    this.archive(job);
    return true;
  }
  private guard(generation: number) {
    if (!this.options.available()) throw Error('PRODUCTION_REQUIRED');
    if (generation !== this.options.generation()) throw Error('WORKSPACE_CHANGED');
    const report=this.scheduledScope?this.options.session.status().report:null;
    if(this.scheduledScope&&report&&report.accountKey!==this.scheduledScope.accountKey)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
  }
  private async verifyWork(source?:WorkBinding) {
    await this.scheduledCheck?.();
    if(!source)return;
    if(this.scheduledScope&&source.fingerprint!==this.scheduledScope.fingerprint)throw Error('FANQIE_WORK_CHANGED');
    if(!this.options.work)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
    const {fingerprint,artistId,...selection}=source;
    const current=await this.options.work(selection);
    if(current.fingerprint!==fingerprint||current.artistId!==artistId)throw Error('FANQIE_WORK_CHANGED');
  }
  private defaults() {
    const archive=path.join(this.folder(),'opening-history');
    const history=fs.existsSync(archive)?fs.readdirSync(archive).filter(file=>/^[a-f0-9-]+\.json$/.test(file)).map(file=>JSON.parse(fs.readFileSync(path.join(archive,file),'utf8')) as Job):[];
    const latest=[...this.jobs(),...history].filter(job=>job.input?.rightsConfirmed&&job.input?.lyricsMatchConfirmed).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    const parsed=FanqieBundleSchema.shape.authors.safeParse(latest?.input.authors);return parsed.success?parsed.data:null;
  }
  private configuration() {
    const file=path.join(this.stateDirectory(),'configuration.json');
    if(!fs.existsSync(file))return null;
    return ConfigurationSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  status() {
    const batch=this.batch.read(),batchError=batch?.authorizationError??batch?.items.find(item=>item.error)?.error;
    return {defaults:this.defaults(),bundle:publicBundle(this.bundle),ready:!!this.prepared && this.prepared.expires>Date.now(),token:this.prepared?.token??null,
      result:this.result,jobs:this.jobs().map(publicJob),batch,batchError:batchError?fanqieCatalogError(Error(batchError)).message:null,
      busy:this.localBusy||this.batchBusy||this.pipelineBusy};
  }
  private async runBatch(queue:FanqieBatch,items:BatchItem[],resume?:boolean,
    scheduled?:ScheduledBatch&{check:(workId?:string)=>Promise<void>}){
    if(this.batchBusy||this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    this.batchBusy=true;
    const generation=this.options.generation();
    try{
      const config=this.configuration(),preference=scheduled?.prepareContract===false?undefined:config?.authorizationPreference;
      if(!config)throw Error('FANQIE_CONFIGURATION_REQUIRED');
      if(scheduled&&(sha(config)!==scheduled.configurationHash||scheduled.prepareContract!==false&&!preference))throw Error('FANQIE_CONFIGURATION_CHANGED');
      const guard=()=>this.guard(generation);
      guard();
      if(!this.options.work)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
      const sources=new Map<string,FanqieWorkSource>();
      const prior=resume?queue.read():null;
      for(const item of items){
        if(prior?.items.find(row=>row.workId===item.workId)?.state==='complete')continue;
        const scope=scheduled?.items.find(record=>record.workId===item.workId);
        const selection={...item,...(scope?.useVersionMetadata?{useVersionMetadata:scope.useVersionMetadata}:{})};
        const source=await this.options.work(selection);guard();
        if(scope&&source.fingerprint!==scope.fingerprint)throw Error('FANQIE_WORK_CHANGED');
        sources.set(item.workId,source);
      }
      const mixedArtists=new Set([...sources.values()].map(source=>source.artistId)).size>1;
      if(mixedArtists&&[...sources.values()].some(source=>!config.artistAuthors?.[source.artistId]&&!source.credits))
        throw Error('FANQIE_ARTIST_CREDITS_REQUIRED');
      await scheduled?.check();
      if(!this.options.session.status().connected)await this.options.session.ui('open');
      const initial=await this.options.session.run((context,sessionGuard)=>this.options.session.inspect(context,sessionGuard));
      guard();
      const accountKey=initial.report.accountKey;
      if(scheduled&&accountKey!==scheduled.accountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
      this.batchAccountKey=accountKey;
      const batch=await queue.run(items,accountKey,async item=>{
        if(scheduled){
          const selection=scheduled.items.find(record=>record.workId===item.workId)!;
          this.scheduledScope={accountKey,fingerprint:selection.fingerprint,prepareContract:scheduled.prepareContract};
          this.scheduledCheck=()=>scheduled.check(item.workId);
        }
        try{
          const expected=sources.get(item.workId);
          const state=await this.publishConfigured({...item,useVersionMetadata:expected?.useVersionMetadata},false,expected);
          if(scheduled&&!state.result?.uploaded)
            throw Error(state.result?.reason??'FANQIE_RECONCILIATION_REQUIRED');
          if(!state.result?.uploaded&&!state.result?.matches?.length)throw Error('FANQIE_RECONCILIATION_REQUIRED');
          return {result:state.result};
        }finally{this.scheduledScope=undefined;this.scheduledCheck=undefined;}
      },guard,resume,preference?async completed=>{
        const jobs=this.jobs(),ids:string[]=[];
        for(const item of completed){
          const outcome=(item.result as BatchUploadResult|undefined)?.result;
          if(!outcome?.uploaded)continue;
          const id=outcome.officialRecord?.id;
          const job=jobs.find(job=>job.accountKey===accountKey&&job.input.workId===item.workId&&job.officialRecord?.id===id);
          if(!id||!job)
            throw Error('FANQIE_RECONCILIATION_REQUIRED');
          if(!sameAuthorization(job.input.authorizationPreference,preference))
            throw Error('FANQIE_CONFIGURATION_CHANGED');
          ids.push(id);
        }
        if(new Set(ids).size!==ids.length||scheduled&&ids.length!==items.length)
          throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
        const verify=async()=>{guard();await scheduled?.check();guard();};
        return ids.length?authorizeFanqieRecords(this.options.root,this.options.session,accountKey,ids,preference,
          verify,this.stateDirectory(),!!scheduled):[];
      }:undefined,sha(config));
      return {...this.status(),batch};
    }finally{this.batchAccountKey=undefined;this.batchBusy=false;}
  }
  private async runDirectory<T>(task:()=>Promise<T>):Promise<T> {
    if(this.batchBusy||this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    this.directoryBusy=true;this.batchBusy=true;
    try { return await task(); }
    finally { this.directoryBusy=false;this.batchBusy=false; }
  }
  async ui(action: unknown, input: unknown = {}):Promise<any> {
    if(action==='downloadStatus'){
      empty.parse(input);
      this.guard(this.options.generation());
      return this.directory.status(this.directoryBusy);
    }
    if(this.batchBusy&&action!=='status')throw Error('FANQIE_BROWSER_BUSY');
    if(action==='previewDownloads'){
      empty.parse(input);
      return this.directory.preview();
    }
    if(action==='openDownloadDiagnostics'){
      empty.parse(input);
      this.guard(this.options.generation());
      return this.directory.showDiagnostics();
    }
    if(action==='reconcileDownloads'){
      const continuation=continueDownloads.or(empty.transform(()=>undefined)).parse(input);
      return this.runDirectory(()=>this.directory.reconcile({continuation}));
    }
    if(action==='publishDownloads'){
      const parameters=fanqieDirectoryPreferencesSchema.partial().extend({fingerprint:scopedHash,consent:z.literal(true),
        replaceBatchId:z.uuid().optional()}).parse(input);
      return this.runDirectory(()=>this.directory.publish(parameters));
    }
    if(action==='publishBatch'){
      const request=z.strictObject({items:z.array(FanqieWorkSelection).min(1).max(50).refine(items=>new Set(items.map(i=>i.workId)).size===items.length),resume:z.boolean().optional()}).parse(input);
      return this.runBatch(this.batch,request.items,request.resume);
    }
    if(action==='authorizeExisting'){
      const request=z.strictObject({accountKey:z.string().regex(/^[a-f0-9]{64}$/),ids:z.array(z.string().regex(/^[1-9]\d{4,24}$/)).min(1).max(50).refine(ids=>new Set(ids).size===ids.length)}).parse(input);
      const config=this.configuration();if(!config?.authorizationPreference)throw Error('FANQIE_CONFIGURATION_REQUIRED');
      if(this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
      this.batchBusy=true;const generation=this.options.generation();
      try{const authorization=await authorizeFanqieRecords(this.options.root,this.options.session,request.accountKey,request.ids,config.authorizationPreference,()=>this.guard(generation),this.stateDirectory());return {...this.status(),authorization};}
      finally{this.batchBusy=false;}
    }
    if(action==='configuration'){empty.parse(input);this.guard(this.options.generation());const configuration=this.configuration();return {configuration,configurationHash:configuration?createHash('sha256').update(JSON.stringify(configuration)).digest('hex'):null,suggestedAuthors:this.defaults()};}
    if(action==='saveConfiguration'){
      this.guard(this.options.generation());if(this.pipelineBusy||this.localBusy)throw Error('FANQIE_BROWSER_BUSY');
      const config=ConfigurationSchema.parse(input),file=path.join(this.stateDirectory(),'configuration.json');
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2));fs.renameSync(file+'.tmp',file);
      return {configuration:config};
    }
    if(action==='publishConfigured'){if(this.pipelineBusy||this.localBusy)throw Error('FANQIE_BROWSER_BUSY');this.batchBusy=true;try{return await this.publishConfigured(input);}finally{this.batchBusy=false;}}
    if(action==='status')return {...await this.runAction(action,input),busy:this.localBusy||this.pipelineBusy||this.batchBusy};
    if(this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    if(action!=='publishWork')return this.runAction(action,input);
    return this.publishWork(input);
  }
  private async publishWork(input:unknown,expectedSource?:FanqieWorkSource):Promise<any>{
    const request=FanqieWorkSelection.extend({authors:FanqieBundleSchema.shape.authors,ai:z.boolean(),rightsConfirmed:z.literal(true),lyricsMatchConfirmed:z.literal(true)}).parse(input);
    this.pipelineBusy=true;const generation=this.options.generation();
    try{
      this.guard(generation);
      if(!this.options.session.status().connected)await this.options.session.ui('open');
      this.guard(generation);this.options.session.mark('正在准备发布素材');
      await this.runAction('selectWork',{workId:request.workId,variant:request.variant,useVersionMetadata:request.useVersionMetadata,
        authors:request.authors,ai:request.ai,createPublicationCopies:true});
      this.guard(generation);
      if(expectedSource&&(this.bundle?.source?.artistId!==expectedSource.artistId||
          this.bundle?.source?.fingerprint!==expectedSource.fingerprint))throw Error('FANQIE_WORK_CHANGED');
      const bundle = this.bundle!;
      const prior=await this.options.session.run(async(context,guard)=>{
        const current=await this.options.session.inspect(context,guard);
        guard();this.guard(generation);
        if(this.batchAccountKey&&current.report.accountKey!==this.batchAccountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
        const job=this.jobs().find(job=>job.accountKey===current.report.accountKey&&job.recordingSha256===bundle.assets.audio.sha256);
        return job&&!this.recoverClosedEditor(job,bundle,current,context)?job:null;
      });
      this.guard(generation);
      if(prior){
        if(prior.phase==='unknown'&&['opening-form','open-release'].includes(prior.pending??''))await this.runAction('recoverOpening',{id:prior.id});
        else return await this.runAction('reconcile',{id:prior.id});
      }
      const prepared=await this.runAction('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});this.guard(generation);
      if(!prepared.ready)return prepared;
      return await this.runAction('upload',{token:prepared.token,consent:true});
    }finally{this.pipelineBusy=false;}
  }
  private async publishConfigured(input:unknown,authorize=true,expected?:FanqieWorkSource):Promise<any>{
      const generation=this.options.generation();this.guard(generation);
      const selection=FanqieWorkSelection.parse(input),config=this.configuration();
      if(!config)throw Error('FANQIE_CONFIGURATION_REQUIRED');
      if(!this.options.work)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
      const source=await this.options.work(selection);
      if(expected&&(expected.fingerprint!==source.fingerprint||expected.artistId!==source.artistId))throw Error('FANQIE_WORK_CHANGED');
      if(!['generated','assisted','none'].includes(source.ai))throw Error('FANQIE_AI_DISCLOSURE_REQUIRED');
      const authors=config.artistAuthors?.[source.artistId]??source.credits??config.authors;
      const state=await this.publishWork({...selection,authors,ai:source.ai!=='none',rightsConfirmed:true,lyricsMatchConfirmed:true},source);
      if(authorize&&state.result?.uploaded&&state.result.officialRecord?.stage==='contract_pending'&&config.authorizationPreference){
        const report=this.options.session.status().report;if(!report)throw Error('FANQIE_CATALOG_INCOMPLETE');
        state.authorization=await authorizeFanqieRecords(this.options.root,this.options.session,report.accountKey,[state.result.officialRecord.id],config.authorizationPreference,()=>this.guard(generation),this.stateDirectory());
      }
      return state;
    }

  private async runAction(action: unknown, input: unknown = {}) {
    const name = z.enum(['status','pick','selectWork','check','prepare','upload','reconcile','recoverOpening']).parse(action), generation=this.options.generation(); this.guard(generation);
    if (name==='status') {empty.parse(input);return this.status();}
    if (this.localBusy) throw Error('FANQIE_BROWSER_BUSY');
    this.localBusy=true;
    try {
      if(name==='recoverOpening') {
        const request=z.strictObject({id:z.string().regex(/^[a-f0-9]{64}$/)}).parse(input);
        const job=this.jobs().find(item=>item.id===request.id);
        if(!job||job.phase!=='unknown'||!['opening-form','open-release'].includes(job.pending??''))throw Error('FANQIE_RECONCILIATION_REQUIRED');
        return await this.options.session.run(async(context,guard)=>{
          const current=await this.options.session.inspect(context,guard);this.guard(generation);
          if(current.accountId!==job.input.scope.accountId||current.report.accountKey!==job.accountKey)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
          const duplicate=checkFanqieNewUpload(current.catalog,job.title);if(!duplicate.allowed)throw Error(duplicate.reason);
          // These checkpoints precede opening the song editor or selecting any file.
          // Preserve the failed attempt; only an explicit UI action permits a new preflight.
          this.archive(job);
          this.prepared=undefined;this.result={title:job.title,allowed:true,reason:null,matches:[]};return this.status();
        });
      }
      if(name==='selectWork') {
        const request=FanqieWorkSelection.extend({authors:FanqieBundleSchema.shape.authors,ai:z.boolean(),createPublicationCopies:z.literal(true)}).parse(input);
        if(!this.options.work)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
        this.prepared=undefined;this.result=null;this.bundle=undefined;
        const {workId,variant,useVersionMetadata}=request;
        const selection={workId,variant,useVersionMetadata};
        const source=await this.options.work(selection);this.guard(generation);
        const binding={...selection,fingerprint:source.fingerprint,artistId:source.artistId};
        const assets=await (this.options.materials??prepareFanqieWorkMaterials)(this.options.root,source,()=>this.guard(generation));
        await this.verifyWork(binding);this.guard(generation);
        const metadata=FanqieBundleSchema.omit({files:true}).parse({version:1,title:source.title,authors:request.authors,ai:request.ai,musicType:'original'});
        this.bundle={...metadata,assets,source:binding,...(source.instrumental?{instrumental:true}:{})};return this.status();
      }
      if(name==='reconcile') {
        const request=z.strictObject({id:z.string().regex(/^[a-f0-9]{64}$/)}).parse(input);
        const job=this.jobs().find(item=>item.id===request.id);if(!job)throw Error('FANQIE_JOB_NOT_FOUND');
        return await this.options.session.run(async(context,guard)=>{
          const current=await this.options.session.inspect(context,guard);this.guard(generation);
          if(current.report.accountKey!==job.accountKey||current.accountId!==job.input.scope.accountId)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
          const matches=current.catalog.rows.filter(row=>job.officialRecord?row.id===job.officialRecord.id:row.title===job.title&&!job.baselineIds.includes(row.id));
          // A title match cannot reconcile an operation that never reached final confirmation.
          if(!current.catalog.complete||matches.length!==1||matches[0].title!==job.title||(!job.officialRecord&&job.pending!=='first-step:confirm-upload'))throw Error('FANQIE_RECONCILIATION_REQUIRED');
          if(matches[0].stage==='unknown')throw Error('FANQIE_CATALOG_STATUS_UNVERIFIED');
          const batch=this.batch.read();
          const groupIds=new Set(batch?.accountKey===job.accountKey?batch.authorization?.map(record=>record.id):[]);
          for(const candidate of this.jobs()){
            const record=candidate.id===job.id?matches[0]:
              candidate.accountKey===job.accountKey&&groupIds.has(candidate.officialRecord?.id??'')
                ? current.catalog.rows.find(row=>row.id===candidate.officialRecord?.id&&row.title===candidate.title)
                : undefined;
            if(record&&record.stage!=='unknown')this.save({...candidate,phase:record.stage==='contract_pending'?'contract_pending':'recorded',officialRecord:record,pending:null,reason:undefined});
          }
          this.batch.refreshAuthorization(current.report.accountKey,current.catalog.rows);
          this.result={title:job.title,uploaded:true,officialRecord:matches[0]};return this.status();
        });
      }
      if (name==='pick') {
        empty.parse(input); const file=await this.options.pickBundle();this.guard(generation);
        if (file) {this.bundle=loadFanqieBundle(file);this.prepared=undefined;this.result=null;} return this.status();
      }
      if (name==='check') {
        const request=z.strictObject({title:z.string().trim().min(1).max(40)}).parse(input);
        return await this.options.session.run(async(context,guard)=>{
          const current=await this.options.session.inspect(context,guard);this.guard(generation);
          this.result={title:request.title,...checkFanqieNewUpload(current.catalog,request.title)};this.prepared=undefined;return this.status();
        });
      }
      if (name==='prepare') {
        const request=z.strictObject({rightsConfirmed:z.literal(true),lyricsMatchConfirmed:z.literal(true)}).parse(input);
        if (!this.bundle) throw Error('FANQIE_BUNDLE_REQUIRED');
        this.prepared=undefined; const bundle=structuredClone(this.bundle);
        await this.verifyWork(bundle.source);this.guard(generation);
        return await this.options.session.run(async(context,guard)=>{
          const current=await this.options.session.inspect(context,guard,true);this.guard(generation);
          if(this.batchAccountKey&&current.report.accountKey!==this.batchAccountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
          const duplicate=checkUploadTitle(current.catalog,bundle.title,bundle.download?.originalTitle);
          if (!duplicate.allowed) {this.result={title:bundle.title,...duplicate};return this.status();}
          const artists=Object.fromEntries(Object.entries(bundle.authors).filter(([role])=>!bundle.instrumental||role!=='lyricist').map(([role,author])=>{
            const matches=current.artists.filter(artist=>artist.name===author);if(matches.length!==1)throw Error(matches.length?'FANQIE_ARTIST_NAME_AMBIGUOUS':'FANQIE_ARTIST_NAME_NOT_FOUND');return[role,matches[0].artistId];
          }));
          const jobId=sha({account:current.report.accountKey,audio:bundle.assets.audio.sha256});
          if (this.jobs().some(job=>job.id===jobId)) throw Error('FANQIE_RECONCILIATION_REQUIRED');
          const frozen:FanqieInput={workId:bundle.source?.workId??'bundle:'+bundle.assets.audio.sha256,scope:{accountId:current.accountId,artistId:sha(artists),sessionId:randomUUID()},
            title:bundle.title,ai:bundle.ai,musicType:bundle.musicType,authors:bundle.authors,assets:bundle.assets,...request,
            ...(bundle.instrumental?{instrumental:true as const}:{}),
            authorizationPreference:this.configuration()?.authorizationPreference};
          await (this.options.verify??verifyFanqieMaterials)(frozen);guard();this.guard(generation);
          await this.verifyWork(bundle.source);guard();this.guard(generation);
          this.prepared={token:randomUUID(),expires:Date.now()+5*60*1000,generation,input:frozen,artists,accountKey:current.report.accountKey,fingerprint:sha(frozen),source:bundle.source,download:bundle.download};
          this.result={title:bundle.title,allowed:true,reason:null,matches:[]};return this.status();
        });
      }
      const request=z.strictObject({token:z.uuid(),consent:z.literal(true)}).parse(input),prepared=this.prepared;
      if (!prepared||prepared.token!==request.token||prepared.expires<Date.now()||prepared.generation!==generation) throw Error('FANQIE_UPLOAD_AUTHORIZATION_REQUIRED');
      this.prepared=undefined; // One use even on failure; durable journal forbids replay after external work starts.
      await this.verifyWork(prepared.source);this.guard(generation);
      return await this.options.session.run(async(context,guard)=>{
        const current=await this.options.session.inspect(context,guard,true);this.guard(generation);
        if (current.accountId!==prepared.input.scope.accountId || current.report.accountKey!==prepared.accountKey) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
        const duplicate=checkUploadTitle(current.catalog,prepared.input.title,prepared.download?.originalTitle);
        if (!duplicate.allowed) {this.result={title:prepared.input.title,...duplicate};return this.status();}
        for (const [role,id] of Object.entries(prepared.artists as Record<string,string>)) {
          const matches=current.artists.filter(a=>a.name===prepared.input.authors[role as keyof typeof prepared.input.authors]);
          if(matches.length!==1||matches[0].artistId!==id) throw Error('FANQIE_ARTIST_ID_UNVERIFIED');
        }
        await (this.options.verify??verifyFanqieMaterials)(prepared.input);guard();this.guard(generation);
        if (sha(prepared.input)!==prepared.fingerprint) throw Error('FANQIE_ASSET_CHANGED');
        const id=sha({account:prepared.accountKey,audio:prepared.input.assets.audio.sha256});
        if(this.jobs().some(j=>j.id===id)) throw Error('FANQIE_RECONCILIATION_REQUIRED');
        let job:Job={id,title:prepared.input.title,phase:'uploading',pending:'opening-form',accountKey:prepared.accountKey,recordingSha256:prepared.input.assets.audio.sha256,download:prepared.download,
          input:prepared.input,baselineIds:current.catalog.rows.map(r=>r.id),updatedAt:new Date().toISOString()};this.save(job);
        try {
          const assertCurrent=()=>{guard();this.guard(generation)};
          const upload=await (this.options.execute??executeFanqieNativeUpload)(context,prepared.input,{guard:assertCurrent,diagnostic:value=>{const folder=path.join(this.options.root,'diagnostics');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'fanqie-entry.json'),JSON.stringify(value,null,2));},progress:step=>this.options.session.mark(step),intent:async step=>{
            assertCurrent();await this.verifyWork(prepared.source);assertCurrent(); await (this.options.verify??verifyFanqieMaterials)(prepared.input);assertCurrent();
            // Re-read the catalog before the final confirmation to catch another tab/device creating this title.
            if(step==='first-step:confirm-upload'){
              const check=await this.options.session.inspect(context,guard);assertCurrent();
              if(check.accountId!==prepared.input.scope.accountId)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
              const duplicate=checkUploadTitle(check.catalog,prepared.input.title,prepared.download?.originalTitle);if(!duplicate.allowed)throw Error(duplicate.reason);
            }
            job={...job,pending:step};this.save(job);
          }});assertCurrent();
          const after=await this.options.session.inspect(context,guard);assertCurrent();
          if(after.accountId!==prepared.input.scope.accountId)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
          const matches=after.catalog.rows.filter(r=>r.title===job.title&&!job.baselineIds.includes(r.id));
          if(!after.catalog.complete||matches.length!==1||matches[0].stage!=='contract_pending')throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
          job={...job,phase:'contract_pending',pending:null,officialRecord:matches[0]};this.save(job);this.result={title:job.title,uploaded:true,officialRecord:matches[0]};
          if(this.scheduledScope?.prepareContract===false||this.batchAccountKey&&prepared.input.authorizationPreference)
            await upload?.closeUploadPage?.().catch(()=>{});
          this.options.session.mark('上传完成，待授权');return this.status();
        } catch(error) {job={...job,phase:'unknown',reason:fanqieCatalogError(error).code};this.save(job);throw error;}
      });
    // Keep the lock until the awaited browser operation settles, including failures.
    } finally {this.localBusy=false;}
  }
}
