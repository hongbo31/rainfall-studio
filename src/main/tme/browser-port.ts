import type {Page,Locator} from 'playwright-core';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import type {TmeAsset,TmeDraft,TmeIdentity,TmeRemote} from '../../shared/tme';
import type {TmeBrowserPort,UploadRole,Reconciled} from './coordinator';
import {TME_PAGE_CONTRACT,TME_FORM_LABELS,type TmePageContract} from './page-contract';
export class PlaywrightTmePort implements TmeBrowserPort{
 private current?:TmeDraft;
 constructor(private page:Page,private device:string,private session:string,private contract:TmePageContract=TME_PAGE_CONTRACT){}
 private async exactlyOne(locator:Locator){if(await locator.count()!==1)throw Error('PAGE_CONTRACT_CHANGED');return locator;}
 private field(name:string){return this.page.getByLabel(name,{exact:true});}
 private async text(selector:string){if(!selector)throw Error('PAGE_CONTRACT_UNVERIFIED');return(await(await this.exactlyOne(this.page.locator(selector))).innerText()).trim();}
 async observe(draft?:TmeDraft){
  this.current=draft||this.current;
  if(new URL(this.page.url()).origin!==this.contract.origin)return{identity:null,contractVerified:false,blockedReason:'PAGE_ORIGIN_CHANGED',source:this.contract.source};
  if(!this.contract.verified)return{identity:null,contractVerified:false,blockedReason:'PAGE_CONTRACT_UNVERIFIED',source:this.contract.source};
  if(await this.page.getByText(/验证码|安全验证|操作频繁/).filter({visible:true}).count())return{identity:null,contractVerified:true,blockedReason:'HUMAN_VERIFICATION_REQUIRED',source:this.contract.source};
  const identity:TmeIdentity={subject:await this.text(this.contract.subject),displayName:await this.text(this.contract.displayName),device:this.device,session:this.session,source:this.contract.source};
  if(!identity.subject)return{identity:null,contractVerified:true,blockedReason:'LOGIN_REQUIRED',source:this.contract.source};
  if(await this.page.getByText('确认授权模式',{exact:true}).filter({visible:true}).count())return{identity,contractVerified:true,blockedReason:'AUTHORIZATION_MODE_USER_ACTION',source:this.contract.source};
  for(const label of Object.values(TME_FORM_LABELS))await this.exactlyOne(this.field(label));
  await this.exactlyOne(this.page.getByRole('button',{name:'保存草稿',exact:true}));
  return{identity,contractVerified:true,blockedReason:null,source:this.contract.source};
 }
 private values(d:TmeDraft){return{title:d.title,lyricist:d.metadata.lyricist,composer:d.metadata.composer,aiMusic:d.metadata.aiMusic,aiTool:d.metadata.aiTool,generatedOn:d.metadata.generatedOn,lyrics:d.metadata.lyrics,statement:d.metadata.statement};}
 private async assertWrite(d:TmeDraft){
  const observed=await this.observe(d);
  if(!observed.contractVerified||observed.blockedReason)throw Error(observed.blockedReason||'PAGE_CONTRACT_UNVERIFIED');
  const expected=d.identity,actual=observed.identity;
  if(!expected||!actual||(['subject','device','session','source'] as const).some(k=>expected[k]!==actual[k]))throw Error('ACCOUNT_CHANGED');
  if(d.source==='local'&&actual.source!=='browser')throw Error('FIXTURE_CANNOT_AUTHORIZE_PRODUCTION');
 }
 private async matches(d:TmeDraft){for(const[k,value]of Object.entries(this.values(d)))if(await this.field(TME_FORM_LABELS[k as keyof typeof TME_FORM_LABELS]).inputValue()!==value)return false;return true;}
 async reconcile(d:TmeDraft):Promise<Reconciled>{
  const observed=await this.observe(d);if(!observed.contractVerified||!observed.identity)throw Error(observed.blockedReason||'LOGIN_REQUIRED');
  const uploads:TmeDraft['uploads']={};
  for(const role of ['audio','cover','proof'] as const){
   const marker=this.page.locator(this.contract.uploads[role]);
   if(await marker.count()>1)throw Error('PAGE_CONTRACT_CHANGED');
   if(await marker.count()===1){
    // A calibrated contract must expose visible filename and byte-size proof.
    const filename=await marker.getAttribute('data-filename'),size=Number(await marker.getAttribute('data-bytes'));
    const remoteId=await marker.getAttribute('data-remote-id'),a=d.assets[role];
    if(a&&filename===path.basename(a.file||'')&&size===a.bytes&&remoteId)uploads[role]={remoteId,sha256:a.sha256};
    else return{known:false,identity:observed.identity,uploads:{},remote:null,fingerprint:null};
   }
  }
  const marker=this.page.locator(this.contract.draftId);let remote:TmeRemote|null=null;
  if(await marker.count()>1)throw Error('PAGE_CONTRACT_CHANGED');
  if(await marker.count()===1){const id=(await marker.innerText()).trim(),status=await this.text(this.contract.status);if(!['draft','submitted','rejected','published'].includes(status)||!id)throw Error('REMOTE_STATUS_UNKNOWN');remote={id,status:status as TmeRemote['status'],reason:await this.text(this.contract.reason),source:this.contract.source};}
  const allUploaded=(['audio','cover','proof'] as const).every(role=>!!uploads[role]);
  return{known:true,identity:observed.identity,uploads,remote,fingerprint:remote?.status==='draft'&&allUploaded&&await this.matches(d)?d.fingerprint:null};
 }
 async fillFields(d:TmeDraft){
  await this.assertWrite(d);
  if(!await this.matches(d)){
   for(const name of Object.values(TME_FORM_LABELS))if((await this.field(name).inputValue()).trim())throw Error('EXISTING_UNSAVED_DRAFT');
  }
  for(const[k,value]of Object.entries(this.values(d))){await this.assertWrite(d);const field=await this.exactlyOne(this.field(TME_FORM_LABELS[k as keyof typeof TME_FORM_LABELS]));const tag=await field.evaluate(el=>el.tagName);if(tag==='SELECT')await field.selectOption(value);else await field.fill(value);}
  for(const [name,checked]of [['我是作词人',d.metadata.ownLyricist],['我是作曲人',d.metadata.ownComposer]] as const){await this.assertWrite(d);if(checked===null)throw Error('AUTHOR_IDENTITY_REQUIRED');await(await this.exactlyOne(this.page.getByRole('checkbox',{name,exact:true}))).setChecked(checked);}
 }
 async upload(role:UploadRole,asset:TmeAsset){
  if(!this.current)throw Error('DRAFT_CONTEXT_REQUIRED');
  await this.assertWrite(this.current);
  if(!asset.file||!fs.existsSync(asset.file)||fs.statSync(asset.file).size!==asset.bytes||createHash('sha256').update(fs.readFileSync(asset.file)).digest('hex')!==asset.sha256)throw Error('ASSET_HASH_CHANGED');
  const label={audio:'上传音频',cover:'上传封面',proof:'创作证明'}[role];
  await this.assertWrite(this.current);
  await(await this.exactlyOne(this.page.getByLabel(label,{exact:true}))).setInputFiles(asset.file);
  const marker=this.page.locator(this.contract.uploads[role]);await marker.waitFor({state:'visible',timeout:15000});
  const read=await this.reconcile(this.current);if(!read.uploads[role])throw Error('UPLOAD_NOT_VERIFIED');return read.uploads[role]!;
 }
 async saveDraft(){if(!this.current)throw Error('DRAFT_CONTEXT_REQUIRED');await this.assertWrite(this.current);await(await this.exactlyOne(this.page.getByRole('button',{name:'保存草稿',exact:true}))).click({timeout:15000});await this.page.locator(this.contract.draftId).waitFor({state:'visible',timeout:15000});}
}
