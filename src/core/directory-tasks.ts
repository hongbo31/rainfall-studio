import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import type {Repository} from './database';import {hash} from './database';import {digest} from './plan-center/storage';import type {PlanCenterService} from './plan-center';
import {DirectoryTaskConfigureSchema,DirectoryTaskIdentitySchema,DirectoryTaskReadySchema,DirectoryTaskRequestSchema,DirectoryTaskSaveSchema,type DirectoryTaskSource,type DirectoryTaskEntry} from '../shared/directory-tasks';
import {directoryFileAttributes} from './directory-file-attributes';

type Options={dataRoot:string;now?:()=>Date;center:()=>PlanCenterService;fileAttributes?:(file:string)=>number};
type Observation={id:string;sourceId:string;fingerprint:string;since:number};
const prefix='directory-tasks:';const maxBytes=256*1024;
const normalized=(v:string)=>path.resolve(v).toLowerCase();
const within=(candidate:string,root:string)=>{const rel=path.relative(normalized(root),normalized(candidate));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
const identity=(s:fs.BigIntStats)=>({dev:String(s.dev),ino:String(s.ino)});
const sameIdentity=(a:{dev:string;ino:string},b:{dev:string;ino:string})=>a.dev===b.dev&&a.ino===b.ino;
const safeError=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'DIRECTORY_SCAN_FAILED';

/** A read-only file input channel. Only Main can authorize its root. */
export class DirectoryTaskController{
 private epoch=0;private stopped=false;
 constructor(readonly repo:Repository,readonly options:Options){}
 private now(){return (this.options.now?.()??new Date()).toISOString();}
 private rows<T>(kind:string):T[]{return this.repo.all('settings').filter(r=>r.id.startsWith(prefix+kind+':')).map(r=>r.value as T);}
 private get<T>(kind:string,id:string):T|undefined{return this.repo.maybe('settings',prefix+kind+':'+id)?.value;}
 private put<T extends {id:string}>(kind:string,value:T){this.repo.save('settings',{id:prefix+kind+':'+value.id,value});return value;}
 status(){return{sources:this.rows<DirectoryTaskSource>('source'),requests:this.rows<DirectoryTaskEntry>('request'),errors:this.rows<any>('error').slice(-100),plans:this.options.center().list().plans};}
 private source(raw:unknown){const i=DirectoryTaskIdentitySchema.parse(raw),s=this.get<DirectoryTaskSource>('source',i.id);if(!s)throw Error('DIRECTORY_SOURCE_NOT_FOUND');if(s.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');return s;}
 private checkRoot(root:string,expected?:DirectoryTaskSource['rootIdentity']){
  if(!path.isAbsolute(root)||root.startsWith('\\\\'))throw Error('DIRECTORY_SCOPE_REJECTED');
  const absolute=path.resolve(root),parts=path.parse(absolute);
  if(absolute===parts.root||within(absolute,this.options.dataRoot)||within(this.options.dataRoot,absolute))throw Error('DIRECTORY_SCOPE_REJECTED');
  const prohibited=[process.env.WINDIR,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.PROGRAMDATA,process.env.LOCALAPPDATA,process.env.APPDATA,process.env.USERPROFILE?path.join(process.env.USERPROFILE,'.ssh'):undefined,process.env.USERPROFILE?path.join(process.env.USERPROFILE,'.aws'):undefined,process.env.USERPROFILE?path.join(process.env.USERPROFILE,'.codex'):undefined].filter(Boolean) as string[];
  if(prohibited.some(p=>within(absolute,p)||within(p,absolute)))throw Error('DIRECTORY_SCOPE_REJECTED');
  let at=absolute;
  while(at!==path.dirname(at)){const s=fs.lstatSync(at,{bigint:true});if(s.isSymbolicLink())throw Error('DIRECTORY_LINK_REJECTED');at=path.dirname(at);}
  const stat=fs.lstatSync(absolute,{bigint:true});if(!stat.isDirectory())throw Error('DIRECTORY_SCOPE_REJECTED');
  const real=fs.realpathSync.native(absolute);if(normalized(real)!==normalized(absolute))throw Error('DIRECTORY_LINK_REJECTED');
  const id=identity(stat);if(expected&&!sameIdentity(expected,id))throw Error('DIRECTORY_ROOT_CHANGED');return{root:real,id};
 }
 configureDirectory(raw:unknown){
  const i=DirectoryTaskConfigureSchema.parse(raw),checked=this.checkRoot(i.root);
  return this.repo.transaction(()=>{const old=i.id?this.get<DirectoryTaskSource>('source',i.id):undefined;
   if((old?.revision??null)!==i.expectedRevision)throw Error('REVISION_CONFLICT');
   if(this.rows<DirectoryTaskSource>('source').some(s=>s.id!==old?.id&&(within(s.root,checked.root)||within(checked.root,s.root))))throw Error('DIRECTORY_SOURCE_OVERLAP');
   this.epoch++;
   return this.put('source',{id:old?.id??randomUUID(),revision:(old?.revision??0)+1,root:checked.root,rootIdentity:checked.id,enabled:false,intervalSeconds:old?.intervalSeconds??10,readiness:old?.readiness??'stable-json',planId:null,planRevision:null,authorizationHash:null,createdAt:old?.createdAt??this.now(),updatedAt:this.now()} satisfies DirectoryTaskSource);
  });
 }
 save(raw:unknown){const i=DirectoryTaskSaveSchema.parse(raw);return this.repo.transaction(()=>{
  const s=this.source({id:i.id,expectedRevision:i.expectedRevision}),p=this.options.center().list().plans.find(p=>p.id===i.planId);if(!p||p.revision!==i.planRevision)throw Error('DIRECTORY_PLAN_CHANGED');this.checkRoot(s.root,s.rootIdentity);this.epoch++;
  return this.put('source',{...s,revision:s.revision+1,enabled:false,planId:p.id,planRevision:p.revision,authorizationHash:this.options.center().preview({id:p.id}).summaryHash,intervalSeconds:i.intervalSeconds,readiness:i.readiness,error:undefined,updatedAt:this.now()});
 });}
 private assertPlan(s:DirectoryTaskSource){const center=this.options.center(),p=center.list().plans.find(p=>p.id===s.planId);if(!p||p.revision!==s.planRevision||center.preview({id:p.id}).summaryHash!==s.authorizationHash)throw Error('DIRECTORY_PLAN_CHANGED');return p;}
 resume(raw:unknown){return this.repo.transaction(()=>{const s=this.source(raw);this.checkRoot(s.root,s.rootIdentity);this.assertPlan(s);this.epoch++;return this.put('source',{...s,revision:s.revision+1,enabled:true,error:undefined,updatedAt:this.now()});});}
 pause(raw:unknown){return this.repo.transaction(()=>{const s=this.source(raw);this.epoch++;return this.put('source',{...s,revision:s.revision+1,enabled:false,updatedAt:this.now()});});}
 stop(raw:unknown){return this.repo.transaction(()=>{const s=this.source(raw);this.epoch++;
  for(const r of this.rows<DirectoryTaskEntry>('request').filter(r=>r.sourceId===s.id&&!['completed','stopped'].includes(r.state))){if(r.runId)this.options.center().stop({runId:r.runId});this.put('request',{...r,state:'stopped',error:'DIRECTORY_STOP_REQUESTED',updatedAt:this.now()});}
  return this.put('source',{...s,revision:s.revision+1,enabled:false,updatedAt:this.now()});
 });}
 interrupt(){this.epoch++;}
 close(){this.epoch++;this.stopped=true;}
 private active(epoch:number,s:DirectoryTaskSource){if(this.stopped||epoch!==this.epoch)throw Error('DIRECTORY_SCAN_CANCELLED');const current=this.get<DirectoryTaskSource>('source',s.id);if(!current?.enabled||current.revision!==s.revision)throw Error('DIRECTORY_SCAN_CANCELLED');}
 private error(s:DirectoryTaskSource,file:string,code:string){const id=hash([s.id,file,code]);return this.put('error',{id,sourceId:s.id,file:path.basename(file),code,at:this.now()});}
 private child(root:string,file:string,directory=false){
  if(!within(file,root)||normalized(file)===normalized(root))throw Error('DIRECTORY_SCOPE_REJECTED');
  const stat=fs.lstatSync(file,{bigint:true});if(stat.isSymbolicLink()||(!directory&&stat.nlink!==1n))throw Error('DIRECTORY_LINK_REJECTED');
  const attrs=(this.options.fileAttributes??directoryFileAttributes)(file);
  // Reparse, offline, recall-on-open and recall-on-data-access are not hydrated by this reader.
  if(attrs&(0x400|0x1000|0x40000|0x400000))throw Error('DIRECTORY_PLACEHOLDER_UNSUPPORTED');
  if(directory?!stat.isDirectory():!stat.isFile())throw Error('DIRECTORY_FILE_REJECTED');
  if(normalized(fs.realpathSync.native(file))!==normalized(file))throw Error('DIRECTORY_LINK_REJECTED');return stat;
 }
 private read(root:string,file:string){
  const before=this.child(root,file);if(before.size>BigInt(maxBytes))throw Error('DIRECTORY_SIZE_LIMIT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  try{const first=fs.fstatSync(fd,{bigint:true});if(!sameIdentity(identity(before),identity(first))||first.nlink!==1n)throw Error('DIRECTORY_FILE_CHANGED');
   const bytes=fs.readFileSync(fd);if(bytes.length>maxBytes)throw Error('DIRECTORY_SIZE_LIMIT');
   const after=fs.fstatSync(fd,{bigint:true}),atPath=this.child(root,file);if(!sameIdentity(identity(first),identity(after))||!sameIdentity(identity(first),identity(atPath))||first.size!==after.size||first.mtimeNs!==after.mtimeNs||after.size!==atPath.size||after.mtimeNs!==atPath.mtimeNs||BigInt(bytes.length)!==after.size)throw Error('DIRECTORY_FILE_CHANGED');
   const fingerprint=hash([identity(after),String(after.size),String(after.mtimeNs),hash(bytes)]);return{bytes,sha:hash(bytes),fingerprint};
  }finally{fs.closeSync(fd);}
 }
 private parse(bytes:Buffer){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('DIRECTORY_REQUEST_INVALID_JSON');}}
 private accept(s:DirectoryTaskSource,raw:unknown,payloadSha256:string){
  const parsed=DirectoryTaskRequestSchema.safeParse(raw);if(!parsed.success)throw Error('DIRECTORY_REQUEST_SCHEMA');const request=parsed.data;
  if(request.planId!==s.planId||request.planRevision!==s.planRevision)throw Error('DIRECTORY_REQUEST_PLAN_MISMATCH');this.assertPlan(s);
  return this.repo.transaction(()=>{
   const rootIdentity=digest([s.root.toLowerCase(),s.rootIdentity]);const id=digest([rootIdentity,request.requestId.toLowerCase(),request.revision]);const semanticHash=digest({...request,requestId:request.requestId.toLowerCase()});const old=this.get<DirectoryTaskEntry>('request',id);
   if(old){if(old.semanticHash!==semanticHash)throw Error('DIRECTORY_REQUEST_REVISION_CONFLICT');return old;}
   if(this.rows<DirectoryTaskEntry>('request').some(r=>r.sourceRootIdentity===rootIdentity&&r.request.requestId.toLowerCase()===request.requestId.toLowerCase()&&r.request.revision>request.revision))throw Error('DIRECTORY_REQUEST_STALE_REVISION');
   if(this.rows<DirectoryTaskEntry>('request').length>=10000)throw Error('DIRECTORY_REQUEST_HISTORY_LIMIT');
   return this.put('request',{id,sourceId:s.id,sourceRootIdentity:rootIdentity,request,semanticHash,payloadSha256,state:'queued',createdAt:this.now(),updatedAt:this.now()} satisfies DirectoryTaskEntry);
  });
 }
 private async scan(s:DirectoryTaskSource){const epoch=this.epoch;this.active(epoch,s);
  try{this.checkRoot(s.root,s.rootIdentity);this.assertPlan(s);this.put('source',{...s,lastScanAt:this.now(),error:undefined});
   const files=fs.readdirSync(s.root,{withFileTypes:true});if(files.length>1000)throw Error('DIRECTORY_ENTRY_LIMIT');
   const eligible=files.filter(ent=>s.readiness==='stable-json'?ent.name.toLowerCase().endsWith('.rainfall-request.json'):ent.isDirectory()||ent.isSymbolicLink()).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
   const next=s.scanCursor?eligible.findIndex(ent=>ent.name>s.scanCursor!):0,start=next<0?0:next;
   const batch=[...eligible.slice(start),...eligible.slice(0,start)].slice(0,100);
   for(const ent of batch){await new Promise<void>(resolve=>setImmediate(resolve));this.active(epoch,s);const file=path.join(s.root,ent.name);
    if(s.readiness==='stable-json'&&!ent.name.toLowerCase().endsWith('.rainfall-request.json'))continue;
    if(s.readiness==='ready-package'&&!ent.isDirectory()&&!ent.isSymbolicLink())continue;
    try{
     if(s.readiness==='stable-json'){
      const read=this.read(s.root,file),id=hash([s.id,ent.name]),old=this.get<Observation>('observation',id),now=Date.parse(this.now());
      if(!old||old.fingerprint!==read.fingerprint){this.put('observation',{id,sourceId:s.id,fingerprint:read.fingerprint,since:now});continue;}
      if(now-old.since<2000)continue;this.active(epoch,s);this.accept(s,this.parse(read.bytes),read.sha);
     }else{
      this.child(s.root,file,true);const readyFile=path.join(file,'READY.json');if(!fs.existsSync(readyFile))continue;
      const readyBefore=this.read(s.root,readyFile),ready=DirectoryTaskReadySchema.safeParse(this.parse(readyBefore.bytes));if(!ready.success)throw Error('DIRECTORY_READY_SCHEMA');
      const request=this.read(s.root,path.join(file,'request.json'));if(request.sha!==ready.data.requestSha256)throw Error('DIRECTORY_READY_HASH_MISMATCH');
      const value=DirectoryTaskRequestSchema.safeParse(this.parse(request.bytes));if(!value.success||value.data.requestId!==ready.data.requestId||value.data.revision!==ready.data.revision)throw Error('DIRECTORY_READY_IDENTITY_MISMATCH');
      if(this.read(s.root,readyFile).fingerprint!==readyBefore.fingerprint)throw Error('DIRECTORY_FILE_CHANGED');this.active(epoch,s);this.accept(s,value.data,request.sha);
     }
    }catch(e){if(safeError(e)==='DIRECTORY_SCAN_CANCELLED')throw e;this.error(s,ent.name,safeError(e));}
   }
   this.active(epoch,s);const current=this.get<DirectoryTaskSource>('source',s.id);if(current&&batch.length)this.put('source',{...current,scanCursor:batch.at(-1)!.name});
  }catch(e){const code=safeError(e);if(code==='DIRECTORY_SCAN_CANCELLED')return;const current=this.get<DirectoryTaskSource>('source',s.id);if(current?.revision===s.revision)this.put('source',{...current,lastScanAt:this.now(),error:code});}
 }
 private dispatch(){
  for(const entry of this.rows<DirectoryTaskEntry>('request')){
   const source=this.get<DirectoryTaskSource>('source',entry.sourceId);if(!source)continue;
   if(entry.runId){const run=this.options.center().list().runs.find(r=>r.id===entry.runId);if(run&&entry.state!=='stopped'){const state=run.state==='completed'?'completed':run.state==='stopped'?'stopped':run.state==='failed'?'blocked':'bound';this.put('request',{...entry,state,error:run.reason,updatedAt:this.now()});}continue;}
   if(entry.state!=='queued'||!source.enabled||this.stopped)continue;
   try{this.repo.transaction(()=>{this.checkRoot(source.root,source.rootIdentity);if(entry.sourceRootIdentity!==digest([source.root.toLowerCase(),source.rootIdentity]))throw Error('DIRECTORY_SOURCE_CHANGED');const plan=this.assertPlan(source);if(entry.request.planId!==plan.id||entry.request.planRevision!==plan.revision)throw Error('DIRECTORY_PLAN_CHANGED');
    const center=this.options.center(),preview=center.preview({id:plan.id});const run=center.runDirectory({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:'directory:'+entry.id});
    this.put('request',{...entry,runId:run.id,state:'bound',updatedAt:this.now()});
   });}catch(e){const code=safeError(e);if(code!=='ACTIVE_RUN')this.put('request',{...entry,state:'blocked',error:code,updatedAt:this.now()});}
  }
 }
 async scanNow(raw:unknown){const epoch=this.epoch,s=this.source(raw);if(!s.enabled)throw Error('DIRECTORY_SOURCE_PAUSED');await this.scan(s);if(epoch===this.epoch&&!this.stopped)this.dispatch();return this.status();}
 async tick(){if(this.stopped)return;const epoch=this.epoch;for(const s of this.rows<DirectoryTaskSource>('source').filter(s=>s.enabled)){if(!s.lastScanAt||Date.parse(this.now())-Date.parse(s.lastScanAt)>=s.intervalSeconds*1000)await this.scan(s);if(epoch!==this.epoch||this.stopped)return;}this.dispatch();}
}
