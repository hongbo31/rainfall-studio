import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {digest} from '../../core/assets';
import {verifyFanqieMaterials} from '../../core/fanqie';
import type {FanqieInput, FanqieAsset, FanqieRole} from '../../shared/fanqie';
import {checkFanqieNewUpload, type FanqieCatalogRow} from '../../shared/fanqie-catalog';
import {FanqieCatalogSession, fanqieCatalogError} from './catalog-session';
import {executeFanqieNativeUpload} from './native-upload';
import {FanqieWorkSelection,type FanqieWorkSource} from '../../core/fanqie-work';
import {prepareFanqieWorkMaterials} from './materials';
import {FanqieBatch} from './batch';
import {authorizeFanqieRecords} from './authorize-records';

const name = z.string().trim().min(1).max(40);
const localName = z.string().min(1).max(200).refine(v => !/[\\/:\x00]/.test(v) && !['.','..'].includes(v), 'Relative basename required');
export const FanqieBundleSchema = z.strictObject({version:z.literal(1), title:name, ai:z.boolean(), musicType:z.literal('original'),
  authors:z.strictObject({lyricist:name,composer:name,singer:name}), files:z.strictObject({audio:localName,lyrics:localName,cover:localName})});
type WorkBinding = {workId:string;variant:'A'|'B';fingerprint:string};
const ConfigurationSchema=z.strictObject({version:z.literal(1),authors:FanqieBundleSchema.shape.authors,useWorkMaterials:z.literal(true),publicationConsent:z.literal(true),authorizationPreference:z.strictObject({mode:z.enum(['exclusive','nonexclusive']),platforms:z.array(z.enum(['fanqie_music','fanqie_audio'])).min(1).max(2).refine(v=>new Set(v).size===v.length&&v.includes('fanqie_music')),confirmContractManually:z.literal(true)}).optional()});
type Bundle = Omit<z.infer<typeof FanqieBundleSchema>, 'files'> & {assets: Record<FanqieRole,FanqieAsset>;source?:WorkBinding};
type Job = {id:string;title:string;phase:'uploading'|'unknown'|'contract_pending'|'recorded';accountKey:string;recordingSha256:string;
  pending:string|null;updatedAt:string;reason?:string;officialRecord?:FanqieCatalogRow;input:FanqieInput;baselineIds:string[]};
type Options = {root:string;session:FanqieCatalogSession;available:()=>boolean;generation:()=>number;pickBundle:()=>Promise<string|null>;
  work?:(selection:{workId:string;variant:'A'|'B'})=>Promise<FanqieWorkSource>;
  materials?:typeof prepareFanqieWorkMaterials;verify?:typeof verifyFanqieMaterials;execute?:typeof executeFanqieNativeUpload};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const empty = z.strictObject({});
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
  const {input,baselineIds,...visible} = job; return visible;
}
/** Main owns paths, checked account/artist IDs, one-use grants and durable operation intents. */
export class FanqieUploadBroker {
  private bundle?: Bundle;
  private prepared?: {token:string;expires:number;generation:number;input:FanqieInput;artists:unknown;accountKey:string;fingerprint:string;source?:WorkBinding};
  private localBusy = false;
  private pipelineBusy = false;
  private batchBusy = false;
  private readonly batch:FanqieBatch;
  private result: unknown = null;
  constructor(private readonly options: Options) {
    this.batch=new FanqieBatch(options.root);
    for (const job of this.jobs()) if (job.phase === 'uploading') this.save({...job,phase:'unknown',reason:'FANQIE_INTERRUPTED'});
  }
  private folder() {return path.join(this.options.root,'production','fanqie','uploads');}
  private scheduledScope?:{accountKey:string;fingerprint:string};
  private scheduledCheck?:()=>Promise<void>;
  async publishScheduled(raw:unknown,check?:()=>Promise<void>){
    const input=FanqieWorkSelection.extend({accountKey:z.string().regex(/^[a-f0-9]{64}$/),configurationHash:z.string().regex(/^[a-f0-9]{64}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).parse(raw);
    if(this.batchBusy||this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    const configuration=this.configuration();
    if(!configuration||createHash('sha256').update(JSON.stringify(configuration)).digest('hex')!==input.configurationHash)throw Error('FANQIE_CONFIGURATION_CHANGED');
    this.batchBusy=true;this.scheduledScope=input;this.scheduledCheck=check;
    try{return await this.publishConfigured({workId:input.workId,variant:input.variant});}
    finally{this.batchBusy=false;this.scheduledScope=undefined;this.scheduledCheck=undefined;}
  }
  private jobs(): Job[] {
    if (!fs.existsSync(this.folder())) return [];
    return fs.readdirSync(this.folder()).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(this.folder(),f),'utf8')));
  }
  private save(job: Job) {
    fs.mkdirSync(this.folder(),{recursive:true}); const target = path.join(this.folder(),job.id+'.json');
    fs.writeFileSync(target+'.tmp',JSON.stringify({...job,updatedAt:new Date().toISOString()},null,2)); fs.renameSync(target+'.tmp',target);
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
    const current=await this.options.work({workId:source.workId,variant:source.variant});
    if(current.fingerprint!==source.fingerprint)throw Error('FANQIE_WORK_CHANGED');
  }
  private defaults() {
    const archive=path.join(this.folder(),'opening-history');
    const history=fs.existsSync(archive)?fs.readdirSync(archive).filter(file=>/^[a-f0-9-]+\.json$/.test(file)).map(file=>JSON.parse(fs.readFileSync(path.join(archive,file),'utf8')) as Job):[];
    const latest=[...this.jobs(),...history].filter(job=>job.input?.rightsConfirmed&&job.input?.lyricsMatchConfirmed).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    const parsed=FanqieBundleSchema.shape.authors.safeParse(latest?.input.authors);return parsed.success?parsed.data:null;
  }
  private configuration() {
    const file=path.join(this.options.root,'production','fanqie','configuration.json');
    if(!fs.existsSync(file))return null;
    return ConfigurationSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  status() {return {defaults:this.defaults(),bundle:publicBundle(this.bundle),ready:!!this.prepared && this.prepared.expires>Date.now(),token:this.prepared?.token??null,
    result:this.result,jobs:this.jobs().map(publicJob),batch:this.batch.read(),busy:this.localBusy||this.batchBusy};}
  async ui(action: unknown, input: unknown = {}):Promise<any> {
    if(this.batchBusy&&action!=='status')throw Error('FANQIE_BROWSER_BUSY');
    if(action==='publishBatch'){
      const request=z.strictObject({items:z.array(FanqieWorkSelection).min(1).max(50).refine(items=>new Set(items.map(i=>i.workId)).size===items.length),resume:z.boolean().optional()}).parse(input);
      if(this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
      this.batchBusy=true;const generation=this.options.generation();
      try{
        this.guard(generation);if(!this.options.session.status().connected)await this.options.session.ui('open');
        const initial=await this.options.session.run((context,guard)=>this.options.session.inspect(context,guard));this.guard(generation);
        const batch=await this.batch.run(request.items,initial.report.accountKey,async item=>{
          const fresh=await this.options.session.run((context,guard)=>this.options.session.inspect(context,guard));this.guard(generation);
          if(fresh.report.accountKey!==initial.report.accountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
          const state=await this.publishConfigured(item);
          if(!state.result?.uploaded&&!state.result?.matches?.length)throw Error('FANQIE_RECONCILIATION_REQUIRED');
          return {result:state.result,authorization:state.authorization};
        },()=>this.guard(generation),request.resume);
        return {...this.status(),batch};
      }finally{this.batchBusy=false;}
    }
    if(action==='authorizeExisting'){
      const request=z.strictObject({accountKey:z.string().regex(/^[a-f0-9]{64}$/),ids:z.array(z.string().regex(/^[1-9]\d{4,24}$/)).min(1).max(50).refine(ids=>new Set(ids).size===ids.length)}).parse(input);
      const config=this.configuration();if(!config?.authorizationPreference)throw Error('FANQIE_CONFIGURATION_REQUIRED');
      if(this.localBusy||this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
      this.batchBusy=true;const generation=this.options.generation();
      try{const authorization=await authorizeFanqieRecords(this.options.root,this.options.session,request.accountKey,request.ids,config.authorizationPreference,()=>this.guard(generation));return {...this.status(),authorization};}
      finally{this.batchBusy=false;}
    }
    if(action==='configuration'){empty.parse(input);this.guard(this.options.generation());const configuration=this.configuration();return {configuration,configurationHash:configuration?createHash('sha256').update(JSON.stringify(configuration)).digest('hex'):null,suggestedAuthors:this.defaults()};}
    if(action==='saveConfiguration'){
      this.guard(this.options.generation());if(this.pipelineBusy||this.localBusy)throw Error('FANQIE_BROWSER_BUSY');
      const config=ConfigurationSchema.parse(input),file=path.join(this.options.root,'production','fanqie','configuration.json');
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2));fs.renameSync(file+'.tmp',file);
      return {configuration:config};
    }
    if(action==='publishConfigured'){if(this.pipelineBusy||this.localBusy)throw Error('FANQIE_BROWSER_BUSY');this.batchBusy=true;try{return await this.publishConfigured(input);}finally{this.batchBusy=false;}}
    if(action==='status')return {...await this.runAction(action,input),busy:this.localBusy||this.pipelineBusy||this.batchBusy};
    if(this.pipelineBusy)throw Error('FANQIE_BROWSER_BUSY');
    if(action!=='publishWork')return this.runAction(action,input);
    return this.publishWork(input);
  }
  private async publishWork(input:unknown):Promise<any>{
    const request=FanqieWorkSelection.extend({authors:FanqieBundleSchema.shape.authors,ai:z.boolean(),rightsConfirmed:z.literal(true),lyricsMatchConfirmed:z.literal(true)}).parse(input);
    this.pipelineBusy=true;const generation=this.options.generation();
    try{
      this.guard(generation);
      if(!this.options.session.status().connected)await this.options.session.ui('open');
      this.guard(generation);this.options.session.mark('正在准备发布素材');
      await this.runAction('selectWork',{workId:request.workId,variant:request.variant,authors:request.authors,ai:request.ai,createPublicationCopies:true});
      this.guard(generation);
      const current=await this.options.session.run((context,guard)=>this.options.session.inspect(context,guard));
      this.guard(generation);
      const prior=this.jobs().find(job=>job.accountKey===current.report.accountKey&&job.recordingSha256===this.bundle!.assets.audio.sha256);
      if(prior){
        if(prior.phase==='unknown'&&['opening-form','open-release'].includes(prior.pending??''))await this.runAction('recoverOpening',{id:prior.id});
        else return await this.runAction('reconcile',{id:prior.id});
      }
      const prepared=await this.runAction('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});this.guard(generation);
      if(!prepared.ready)return prepared;
      return await this.runAction('upload',{token:prepared.token,consent:true});
    }finally{this.pipelineBusy=false;}
  }
  private async publishConfigured(input:unknown):Promise<any>{
      const generation=this.options.generation();this.guard(generation);
      const selection=FanqieWorkSelection.parse(input),config=this.configuration();
      if(!config)throw Error('FANQIE_CONFIGURATION_REQUIRED');
      if(!this.options.work)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
      const source=await this.options.work(selection);
      if(!['generated','assisted','none'].includes(source.ai))throw Error('FANQIE_AI_DISCLOSURE_REQUIRED');
      const state=await this.publishWork({...selection,authors:config.authors,ai:source.ai!=='none',rightsConfirmed:true,lyricsMatchConfirmed:true});
      if(state.result?.uploaded&&state.result.officialRecord?.stage==='contract_pending'&&config.authorizationPreference){
        const report=this.options.session.status().report;if(!report)throw Error('FANQIE_CATALOG_INCOMPLETE');
        state.authorization=await authorizeFanqieRecords(this.options.root,this.options.session,report.accountKey,[state.result.officialRecord.id],config.authorizationPreference,()=>this.guard(generation));
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
          const archive=path.join(this.folder(),'opening-history');fs.mkdirSync(archive,{recursive:true});
          fs.renameSync(path.join(this.folder(),job.id+'.json'),path.join(archive,job.id+'-'+randomUUID()+'.json'));
          this.prepared=undefined;this.result={title:job.title,allowed:true,reason:null,matches:[]};return this.status();
        });
      }
      if(name==='selectWork') {
        const request=FanqieWorkSelection.extend({authors:FanqieBundleSchema.shape.authors,ai:z.boolean(),createPublicationCopies:z.literal(true)}).parse(input);
        if(!this.options.work)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
        this.prepared=undefined;this.result=null;this.bundle=undefined;
        const source=await this.options.work({workId:request.workId,variant:request.variant});this.guard(generation);
        const binding={workId:request.workId,variant:request.variant,fingerprint:source.fingerprint};
        const assets=await (this.options.materials??prepareFanqieWorkMaterials)(this.options.root,source,()=>this.guard(generation));
        await this.verifyWork(binding);this.guard(generation);
        const metadata=FanqieBundleSchema.omit({files:true}).parse({version:1,title:source.title,authors:request.authors,ai:request.ai,musicType:'original'});
        this.bundle={...metadata,assets,source:binding};return this.status();
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
          this.save({...job,phase:matches[0].stage==='contract_pending'?'contract_pending':'recorded',officialRecord:matches[0],pending:null,reason:undefined});
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
          const duplicate=checkFanqieNewUpload(current.catalog,bundle.title);
          if (!duplicate.allowed) {this.result={title:bundle.title,...duplicate};return this.status();}
          const artists=Object.fromEntries(Object.entries(bundle.authors).map(([role,author])=>{
            const matches=current.artists.filter(artist=>artist.name===author);if(matches.length!==1)throw Error(matches.length?'FANQIE_ARTIST_NAME_AMBIGUOUS':'FANQIE_ARTIST_NAME_NOT_FOUND');return[role,matches[0].artistId];
          }));
          const jobId=sha({account:current.report.accountKey,audio:bundle.assets.audio.sha256});
          if (this.jobs().some(job=>job.id===jobId)) throw Error('FANQIE_RECONCILIATION_REQUIRED');
          const frozen:FanqieInput={workId:bundle.source?.workId??'bundle:'+bundle.assets.audio.sha256,scope:{accountId:current.accountId,artistId:sha(artists),sessionId:randomUUID()},
            title:bundle.title,ai:bundle.ai,musicType:bundle.musicType,authors:bundle.authors,assets:bundle.assets,...request,
            authorizationPreference:this.configuration()?.authorizationPreference};
          await (this.options.verify??verifyFanqieMaterials)(frozen);guard();this.guard(generation);
          await this.verifyWork(bundle.source);guard();this.guard(generation);
          this.prepared={token:randomUUID(),expires:Date.now()+5*60*1000,generation,input:frozen,artists,accountKey:current.report.accountKey,fingerprint:sha(frozen),source:bundle.source};
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
        const duplicate=checkFanqieNewUpload(current.catalog,prepared.input.title);
        if (!duplicate.allowed) {this.result={title:prepared.input.title,...duplicate};return this.status();}
        for (const [role,id] of Object.entries(prepared.artists as Record<string,string>)) {
          const matches=current.artists.filter(a=>a.name===prepared.input.authors[role as keyof typeof prepared.input.authors]);
          if(matches.length!==1||matches[0].artistId!==id) throw Error('FANQIE_ARTIST_ID_UNVERIFIED');
        }
        await (this.options.verify??verifyFanqieMaterials)(prepared.input);guard();this.guard(generation);
        if (sha(prepared.input)!==prepared.fingerprint) throw Error('FANQIE_ASSET_CHANGED');
        const id=sha({account:prepared.accountKey,audio:prepared.input.assets.audio.sha256});
        if(this.jobs().some(j=>j.id===id)) throw Error('FANQIE_RECONCILIATION_REQUIRED');
        let job:Job={id,title:prepared.input.title,phase:'uploading',pending:'opening-form',accountKey:prepared.accountKey,recordingSha256:prepared.input.assets.audio.sha256,
          input:prepared.input,baselineIds:current.catalog.rows.map(r=>r.id),updatedAt:new Date().toISOString()};this.save(job);
        try {
          const assertCurrent=()=>{guard();this.guard(generation)};
          await (this.options.execute??executeFanqieNativeUpload)(context,prepared.input,{guard:assertCurrent,diagnostic:value=>{const folder=path.join(this.options.root,'diagnostics');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'fanqie-entry.json'),JSON.stringify(value,null,2));},progress:step=>this.options.session.mark(step),intent:async step=>{
            assertCurrent();await this.verifyWork(prepared.source);assertCurrent(); await (this.options.verify??verifyFanqieMaterials)(prepared.input);assertCurrent();
            // Re-read the catalog before the final confirmation to catch another tab/device creating this title.
            if(step==='first-step:confirm-upload'){
              const check=await this.options.session.inspect(context,guard);assertCurrent();
              if(check.accountId!==prepared.input.scope.accountId)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
              const duplicate=checkFanqieNewUpload(check.catalog,prepared.input.title);if(!duplicate.allowed)throw Error(duplicate.reason);
            }
            job={...job,pending:step};this.save(job);
          }});assertCurrent();
          const after=await this.options.session.inspect(context,guard);assertCurrent();
          if(after.accountId!==prepared.input.scope.accountId)throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
          const matches=after.catalog.rows.filter(r=>r.title===job.title&&!job.baselineIds.includes(r.id));
          if(!after.catalog.complete||matches.length!==1||matches[0].stage!=='contract_pending')throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
          job={...job,phase:'contract_pending',pending:null,officialRecord:matches[0]};this.save(job);this.result={title:job.title,uploaded:true,officialRecord:matches[0]};
          this.options.session.mark('上传完成，待授权');return this.status();
        } catch(error) {job={...job,phase:'unknown',reason:fanqieCatalogError(error).code};this.save(job);throw error;}
      });
    // Keep the lock until the awaited browser operation settles, including failures.
    } finally {this.localBusy=false;}
  }
}
