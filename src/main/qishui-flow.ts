import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Page,Locator} from 'playwright-core';
import {qishuiOrigin,type QishuiFillInput,type QishuiWorkSource,type QishuiJobStage} from '../shared/qishui';
import {scopedDirectory} from './browser-accounts';

type Job={accountId:string;workId:string;fingerprint:string;stage:QishuiJobStage;step:string;updatedAt:string;title:string;mode?:string};
export function verifyQishuiFile(m:QishuiWorkSource['audio']){
 const stat=fs.lstatSync(m.file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==m.bytes||stat.size>200*1024*1024)throw Error('QISHUI_FILE_CHANGED');
 if(createHash('sha256').update(fs.readFileSync(m.file)).digest('hex')!==m.sha256)throw Error('QISHUI_FILE_CHANGED');
}
async function uniqueVisible(l:Locator){if(await l.count()!==1||!await l.isVisible())throw Error('QISHUI_PAGE_CHANGED');return l;}
// Use the current visible field label, never a cached dynamic DOM id.
async function fieldGroup(page:Page,label:string,role:'radio'|'combobox'){
 let node=await uniqueVisible(page.getByText(label,{exact:true}));
 for(let i=0;i<4;i++){
  node=node.locator('..');
  const n=await node.getByRole(role).count();
  if(n===(role==='radio'?2:1))return node;
  if(n>(role==='radio'?2:1))break;
 }
 throw Error('QISHUI_FIELD_AMBIGUOUS');
}
export class QishuiFlow{
 private busy=new Set<string>();
 private reviews=new Map<string,{accountId:string;workId:string;hash:string;url:string;expires:number}>();
 constructor(private root:string){}
 private file(accountId:string,workId:string){
  if(!/^[a-f0-9-]{36}$/i.test(accountId)||!/^[a-f0-9-]{36}$/i.test(workId))throw Error('QISHUI_SCOPE_INVALID');
  return path.join(scopedDirectory(this.root,'production','qishui-jobs',accountId),workId+'.json');
 }
 status(accountId:string,workId:string):Job|null{
  const f=this.file(accountId,workId);if(!fs.existsSync(f))return null;
  const job=JSON.parse(fs.readFileSync(f,'utf8')) as Job;
  if(job.accountId!==accountId||job.workId!==workId)throw Error('QISHUI_SCOPE_INVALID');
  return job.stage==='running'?{...job,stage:'unknown'}:job;
 }
 private save(job:Job){
  const f=this.file(job.accountId,job.workId);fs.mkdirSync(path.dirname(f),{recursive:true});
  const temp=f+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({...job,updatedAt:new Date().toISOString()},null,2),{flag:'wx'});fs.renameSync(temp,f);
 }
 private assertPage(page:Page,guard:()=>void){guard();if(page.isClosed()||new URL(page.url()).origin!==qishuiOrigin)throw Error('QISHUI_PAGE_CHANGED');}
 private async lock<T>(accountId:string,run:()=>Promise<T>){
  if(this.busy.has(accountId))throw Error('QISHUI_BUSY');this.busy.add(accountId);
  try{return await run();}finally{this.busy.delete(accountId);}
 }
 async fill(page:Page,input:QishuiFillInput,source:QishuiWorkSource,guard:()=>void){
  return this.lock(input.accountId,async()=>{
   this.assertPage(page,guard);
   const old=this.status(input.accountId,input.workId);
   if(old){if(old.fingerprint!==source.fingerprint)throw Error('QISHUI_MATERIAL_CHANGED');throw Error('QISHUI_EXISTING_JOB_REVIEW_REQUIRED');}
   verifyQishuiFile(source.audio);verifyQishuiFile(source.cover);
   // A fresh, read-only catalog tab avoids destroying an unfinished form.
   const catalog=await page.context().newPage();
   try{
    await catalog.goto(qishuiOrigin+'/console/songs',{waitUntil:'domcontentloaded'});
    await catalog.getByRole('heading',{name:'我的歌曲',exact:true}).waitFor({timeout:20000});
    if(await catalog.getByRole('link').filter({hasText:source.title}).count())throw Error('QISHUI_POSSIBLE_DUPLICATE');
    // Never claim pagination was checked if more pages remain.
    const next=catalog.getByRole('button',{name:'Next',exact:true});
    if(await next.count()&&await next.isEnabled())throw Error('QISHUI_CATALOG_REVIEW_REQUIRED');
   }finally{await catalog.close();}
   this.assertPage(page,guard);
   if(new URL(page.url()).pathname==='/console/publish'){
    await(await uniqueVisible(page.getByRole('button',{name:/^发布全曲(?: chevron_right)?$/}))).click();
   }
   await page.getByRole('textbox',{name:'歌曲标题*',exact:true}).waitFor({timeout:20000});
   this.assertPage(page,guard);
   if(new URL(page.url()).pathname!=='/console/complete-publish')throw Error('QISHUI_PAGE_CHANGED');
   const title=await uniqueVisible(page.getByRole('textbox',{name:'歌曲标题*',exact:true}));
   if(await title.inputValue()||await page.getByRole('button',{name:'cloud_upload_stroked 上传完整版',exact:true}).count()!==1)throw Error('QISHUI_NONEMPTY_FORM');
   const performer=await fieldGroup(page,'表演者*','combobox');
   if(await performer.getByRole('button',{name:input.performer+' close',exact:true}).count()!==1)throw Error('QISHUI_PERFORMER_MISMATCH');
   let job:Job={accountId:input.accountId,workId:input.workId,title:source.title,fingerprint:source.fingerprint,stage:'prepared',step:'preflight',updatedAt:new Date().toISOString()};
   this.save(job);
   const act=async(step:string,run:()=>Promise<unknown>)=>{
    this.assertPage(page,guard);job={...job,stage:'running',step};this.save(job);await run();this.assertPage(page,guard);
   };
   try{
    await act('ai',async()=>{const group=await fieldGroup(page,'以下歌曲均使用AI创作*','radio');await group.getByRole('radio',{name:input.ai?'是':'否',exact:true}).check();});
    if(input.ai)await act('ai-tool',async()=>{
     await(await uniqueVisible(page.getByRole('combobox',{name:'使用的AI工具',exact:true}))).click();
     await(await uniqueVisible(page.getByRole('option',{name:'tick '+input.aiTool,exact:true}))).click();
    });
    await act('title',()=>title.fill(source.title));
    await act('instrumental',async()=>{const group=await fieldGroup(page,'是否是纯音乐*','radio');await group.getByRole('radio',{name:source.instrumental?'是':'否',exact:true}).check();});
    if(!source.instrumental)await act('lyrics',()=>page.getByRole('textbox',{name:'歌词*',exact:true}).fill(source.lyrics));
    for(const [label,name] of [['曲作者*',input.composer],...(!source.instrumental?[['词作者*',input.lyricist]]:[])]){
     await act(label,async()=>{
      const group=await fieldGroup(page,label,'combobox');
      if(await group.getByRole('button',{name:name+' close',exact:true}).count()===1)return;
      if(name!==input.performer)throw Error('QISHUI_AUTHOR_SELECTION_REQUIRED');
      await(await uniqueVisible(group.getByRole('button',{name:'添加自己',exact:true}))).click();
      await group.getByRole('button',{name:name+' close',exact:true}).waitFor();
     });
    }
    for(const [step,button,file] of [['audio','cloud_upload_stroked 上传完整版',source.audio],['cover','cloud_upload_stroked 上传封面',source.cover]] as const){
     await act(step,async()=>{
      verifyQishuiFile(file);
      const chooserPromise=page.waitForEvent('filechooser',{timeout:60000});
      await(await uniqueVisible(page.getByRole('button',{name:button,exact:true}))).click();
      const chooser=await chooserPromise;this.assertPage(page,guard);verifyQishuiFile(file);await chooser.setFiles(file.file);
      if(step==='cover'){
       const dialog=page.getByRole('dialog',{name:'调整图片',exact:true});await dialog.waitFor({timeout:20000});
       this.assertPage(page,guard);await dialog.getByRole('button',{name:'confirm',exact:true}).click();
       await dialog.waitFor({state:'hidden'});
      }else await page.getByRole('button',{name:button,exact:true}).waitFor({state:'hidden',timeout:60000});
     });
    }
    if(await title.inputValue()!==source.title)throw Error('QISHUI_READBACK_FAILED');
    if(!source.instrumental&&await page.getByRole('textbox',{name:'歌词*',exact:true}).inputValue()!==source.lyrics)throw Error('QISHUI_READBACK_FAILED');
    this.assertPage(page,guard);job={...job,stage:'form_ready',step:'review-upload'};this.save(job);return job;
   }catch(error){this.save({...job,stage:'unknown'});throw error;}
  });
 }
 async authorization(page:Page,input:{accountId:string;workId:string;mode:string},guard:()=>void){
  return this.lock(input.accountId,async()=>{
   const job=this.status(input.accountId,input.workId);
   if(!job||job.stage!=='form_ready')throw Error('QISHUI_FORM_REVIEW_REQUIRED');
   this.assertPage(page,guard);
   if(new URL(page.url()).pathname!=='/console/complete-publish'||await page.getByRole('textbox',{name:'歌曲标题*',exact:true}).inputValue()!==job.title)throw Error('QISHUI_PAGE_CHANGED');
   this.save({...job,stage:'running',step:'authorization'});
   try{
    await(await uniqueVisible(page.getByRole('button',{name:'下一步',exact:true}))).click();
    await page.getByRole('heading',{name:'签约模式',exact:true}).waitFor({timeout:20000});
    this.assertPage(page,guard);
    const names:Record<string,string>={exclusive_agency:'独家代理发行（3年）',exclusive:'独家授权（3年）',nonexclusive:'非独家授权（3年）'};
    if(!names[input.mode])throw Error('QISHUI_MODE_REQUIRED');
    await(await uniqueVisible(page.getByText(names[input.mode],{exact:true}))).click();
    this.assertPage(page,guard);const next={...job,mode:input.mode,stage:'authorization' as const,step:'review-authorization'};this.save(next);return next;
   }catch(error){this.save({...job,stage:'unknown',step:'authorization'});throw error;}
  });
 }
 async contract(page:Page,input:{accountId:string;workId:string},guard:()=>void){
  return this.lock(input.accountId,async()=>{
   const job=this.status(input.accountId,input.workId);
   if(!job||!['authorization','contract_review'].includes(job.stage))throw Error('QISHUI_AUTHORIZATION_REVIEW_REQUIRED');
   this.assertPage(page,guard);
   if(job.stage==='authorization'){
    await uniqueVisible(page.getByRole('heading',{name:'签约模式',exact:true}));
    this.save({...job,stage:'running',step:'open-contract'});
    try{await(await uniqueVisible(page.getByRole('button',{name:'下一步',exact:true}))).click();}
    catch(error){this.save({...job,stage:'unknown',step:'open-contract'});throw error;}
   }
   try{
    await page.getByRole('button',{name:'接受合同',exact:true}).waitFor({timeout:20000});
    this.assertPage(page,guard);
    const contractText=await page.locator('main').last().innerText();
    if(!contractText.includes(job.title)||!/(合同|协议)/.test(contractText)||contractText.length>200000)throw Error('QISHUI_CONTRACT_SCOPE_UNVERIFIED');
    const contractHash=createHash('sha256').update(contractText).digest('hex'),reviewToken=randomUUID();
    for(const [token,review] of this.reviews)if(review.accountId===input.accountId)this.reviews.delete(token);
    this.reviews.set(reviewToken,{accountId:input.accountId,workId:input.workId,hash:contractHash,url:page.url(),expires:Date.now()+5*60*1000});
    const next={...job,stage:'contract_review' as const,step:'await-current-contract-confirmation'};this.save(next);
    return {...next,contractText,contractHash,reviewToken};
   }catch(error){this.save({...job,stage:'unknown',step:'contract-page-unverified'});throw error;}
  });
 }
 async accept(page:Page,input:{accountId:string;workId:string;reviewToken:string;contractHash:string;confirmed:true},guard:()=>void){
  return this.lock(input.accountId,async()=>{
   const job=this.status(input.accountId,input.workId),review=this.reviews.get(input.reviewToken);
   if(!job||job.stage!=='contract_review'||!input.confirmed||!review||review.accountId!==input.accountId||review.workId!==input.workId||review.expires<Date.now()||review.hash!==input.contractHash||review.url!==page.url())throw Error('QISHUI_CURRENT_CONTRACT_CONFIRMATION_REQUIRED');
   this.assertPage(page,guard);
   const text=await page.locator('main').last().innerText();
   if(createHash('sha256').update(text).digest('hex')!==review.hash)throw Error('QISHUI_CONTRACT_CHANGED');
   const button=await uniqueVisible(page.getByRole('button',{name:'接受合同',exact:true}));
   // One current, user-confirmed contract only; token is never persisted or reused.
   this.reviews.delete(input.reviewToken);this.save({...job,stage:'running',step:'accept-contract'});
   try{
    this.assertPage(page,guard);await button.click();
    await page.getByRole('textbox',{name:/验证码/}).or(page.getByPlaceholder(/验证码/)).first().waitFor({timeout:20000});
    this.assertPage(page,guard);
    const next={...job,stage:'verification_required' as const,step:'user-verification-required'};this.save(next);return next;
   }catch(error){this.save({...job,stage:'unknown',step:'accept-contract'});throw error;}
  });
 }
}
