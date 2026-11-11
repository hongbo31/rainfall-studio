import fs from 'node:fs';
import path from 'node:path';
import type {BrowserContext,Page} from 'playwright-core';
import type {FanqieAuthorizationPreference} from '../../shared/fanqie';
import {FanqieCatalogSession} from './catalog-session';
import {prepareFanqieAuthorization} from './authorization';

const preparedPages=new WeakMap<BrowserContext,Map<string,Page>>();
export async function authorizeFanqieRecords(root:string,session:FanqieCatalogSession,accountKey:string,ids:string[],preference:FanqieAuthorizationPreference,outerGuard:()=>void){
 return session.run(async(context,guard)=>{
  const current=await session.inspect(context,guard);outerGuard();
  if(!current.catalog.complete||current.report.accountKey!==accountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
  const rows=ids.map(id=>{const row=current.catalog.rows.find(r=>r.id===id);if(!row)throw Error('FANQIE_JOB_NOT_FOUND');return row;});
  const results=[];
  for(const row of rows){
   guard();outerGuard();
   if(row.stage!=='contract_pending'){results.push({id:row.id,title:row.title,status:row.officialStatus,phase:'already_processed'});continue;}
   const folder=path.join(root,'production','fanqie','authorizations');fs.mkdirSync(folder,{recursive:true});
   const file=path.join(folder,accountKey+'-'+row.id+'.json');
   const save=(phase:string,step?:string)=>{fs.writeFileSync(file+'.tmp',JSON.stringify({id:row.id,title:row.title,accountKey,phase,step,preference,updatedAt:new Date().toISOString()}));fs.renameSync(file+'.tmp',file);};
   // If a previous signature page remains open, preserve it instead of preparing another contract.
   const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
   const existing=preparedPages.get(context)?.get(row.id);
   if(previous?.phase==='awaiting_signature'&&(!existing||existing.isClosed()))throw Error('FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED');
   if(existing&&!existing.isClosed()&&previous?.phase==='awaiting_signature'){await existing.bringToFront();results.push({id:row.id,title:row.title,status:'等待合同确认',phase:'awaiting_signature'});continue;}
   const page=await context.newPage();save('preparing');
   try{
    session.mark('正在准备《'+row.title+'》授权');
    await page.goto('https://www.novelfm.com/creator/music/finished/ugc',{waitUntil:'domcontentloaded',timeout:20000});
    const target=page.getByRole('row').filter({hasText:'作品ID：'+row.id});await target.waitFor({state:'visible',timeout:20000});
    if(await target.count()!==1||!(await target.innerText()).includes(row.title)||!(await target.innerText()).includes('待授权'))throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
    const beforeWrite=async(step:string)=>{guard();outerGuard();const fresh=await session.inspect(context,guard);outerGuard();if(fresh.report.accountKey!==accountKey||!fresh.catalog.complete)throw Error('FANQIE_BATCH_SCOPE_CHANGED');const latest=fresh.catalog.rows.find(r=>r.id===row.id);if(!latest||latest.title!==row.title||latest.stage!=='contract_pending')throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');save('preparing',step);};
    await beforeWrite('open-existing');await target.locator('svg.serial-fm-icon-general_edit').click();
    await page.getByRole('heading',{name:'选择签约模式',exact:true}).waitFor({state:'visible',timeout:20000});
    await prepareFanqieAuthorization(page,row.title,preference,beforeWrite);
    save('awaiting_signature');if(!preparedPages.has(context))preparedPages.set(context,new Map());preparedPages.get(context)!.set(row.id,page);
    results.push({id:row.id,title:row.title,status:'等待合同确认',phase:'awaiting_signature'});
   }catch(error){save('needs_reconciliation');throw error;}
  }
  session.mark('授权信息已准备，合同由你确认');return results;
 });
}
