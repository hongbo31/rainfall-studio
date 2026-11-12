import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {BrowserContext,Page} from 'playwright-core';
import {fanqieOrigin,type FanqieAuthorizationPreference,type FanqieAuthorizationResult} from '../../shared/fanqie';
import {assertFanqieCatalogUrl,fanqieCatalogPath,type FanqieCatalogRow} from '../../shared/fanqie-catalog';
import {FanqieCatalogSession} from './catalog-session';
import {assertFanqieAuthorizationLocation,prepareFanqieAuthorization} from './authorization';

type Work = Pick<FanqieCatalogRow,'id'|'title'>;
type Journal = {
  id?: string;
  title?: string;
  records?: Work[];
  accountKey: string;
  phase: 'preparing' | 'awaiting_signature' | 'needs_reconciliation';
  step?: string;
  preference: FanqieAuthorizationPreference;
  updatedAt: string;
};
const preparedPages=new WeakMap<BrowserContext,Map<string,Page>>();

export async function authorizeFanqieRecords(
  root:string,session:FanqieCatalogSession,accountKey:string,ids:string[],
  preference:FanqieAuthorizationPreference,outerGuard:()=>void,
  stateDirectory=path.join(root,'production','fanqie'),
):Promise<FanqieAuthorizationResult[]> {
  return session.run(async(context,guard)=>{
    const inspect=async()=>{
      guard();outerGuard();
      const current=await session.inspect(context,guard);
      outerGuard();
      if(!current.catalog.complete||current.report.accountKey!==accountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
      return current.catalog.rows;
    };
    const catalog=await inspect();
    const rows=ids.map(id=>{
      const row=catalog.find(row=>row.id===id);
      if(!row)throw Error('FANQIE_JOB_NOT_FOUND');
      return row;
    });
    const pending=rows.filter(row=>row.stage==='contract_pending');
    const results=():FanqieAuthorizationResult[]=>rows.map(row=>({
      id:row.id,title:row.title,
      status:row.stage==='contract_pending'?'等待合同确认':row.officialStatus,
      phase:row.stage==='contract_pending'?'awaiting_signature':'already_processed',
    }));
    if(!pending.length)return results();

    const verifyPending=(latest:FanqieCatalogRow[])=>{
      for(const {id,title} of pending){
        // The official add-song picker only displays titles. Require a unique pending record for each.
        const matches=latest.filter(row=>row.title===title&&row.stage==='contract_pending');
        if(matches.length!==1||matches[0].id!==id)throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
      }
    };
    verifyPending(catalog);
    const records=pending.map(({id,title})=>({id,title})).sort((a,b)=>a.id.localeCompare(b.id));
    const pendingIds=new Set(records.map(record=>record.id));
    const folder=path.join(stateDirectory,'authorizations');
    fs.mkdirSync(folder,{recursive:true});
    const key=records.length===1?records[0].id:'batch-'+createHash('sha256').update(JSON.stringify([...pendingIds])).digest('hex');
    const prefix=accountKey+'-',filename=prefix+key+'.json',file=path.join(folder,filename);
    const save=(phase:Journal['phase'],step:string)=>{
      const journal:Journal={
        ...(records.length===1?records[0]:{}),records,accountKey,phase,step,preference,updatedAt:new Date().toISOString(),
      };
      fs.writeFileSync(file+'.tmp',JSON.stringify(journal));
      fs.renameSync(file+'.tmp',file);
    };

    for(const name of fs.readdirSync(folder)){
      if(!name.startsWith(prefix)||!/^([1-9]\d{4,24}|batch-[a-f0-9]{64})\.json$/.test(name.slice(prefix.length)))continue;
      const previous=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8')) as Journal;
      const works=previous.records??[{id:previous.id,title:previous.title}];
      if(!works.some(work=>work.id&&pendingIds.has(work.id))||
          (previous.phase!=='awaiting_signature'&&previous.step!=='authorization:preview'))continue;
      const existing=preparedPages.get(context)?.get(file);
      if(name!==filename||previous.accountKey!==accountKey||JSON.stringify(works)!==JSON.stringify(records)||
          JSON.stringify(previous.preference)!==JSON.stringify(preference)||!existing||existing.isClosed())
        throw Error('FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED');
      assertFanqieAuthorizationLocation(existing);
      if(!(await existing.getByRole('heading',{name:'确认签约协议',exact:true}).isVisible()))
        throw Error('FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED');
      await existing.bringToFront();
      return results();
    }

    const page=await context.newPage();
    const anchor=pending[0];
    let step='open-catalog';
    try{
      save('preparing',step);
      session.mark('正在准备 '+pending.length+' 首作品的授权');
      await page.goto(fanqieOrigin+fanqieCatalogPath,{waitUntil:'domcontentloaded',timeout:20000});
      const idText=new RegExp('^作品ID[：:]\\s*'+anchor.id+'$','u');
      const target=page.getByRole('row').filter({has:page.getByText(idText)});
      await target.waitFor({state:'visible',timeout:20000});
      const beforeWrite=async(next:string)=>{
        verifyPending(await inspect());
        step=next;
        save('preparing',step);
      };
      await beforeWrite('open-existing');
      assertFanqieCatalogUrl(page.url());
      const cells=await target.getByRole('cell').allInnerTexts();
      const [title,id]=cells[0]?.trim().split('\n')??[];
      if(await target.count()!==1||title!==anchor.title||!idText.test(id??'')||cells[1]?.trim()!=='待授权')
        throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
      await target.locator('svg.serial-fm-icon-general_edit').click();
      await page.getByRole('heading',{name:'选择签约模式',exact:true}).waitFor({state:'visible',timeout:20000});
      await prepareFanqieAuthorization(page,pending.map(row=>row.title),preference,beforeWrite);
      save('awaiting_signature',step);
      let pages=preparedPages.get(context);
      if(!pages){pages=new Map();preparedPages.set(context,pages);}
      pages.set(file,page);
      await page.bringToFront();
      session.mark(pending.length+' 首作品待确认同一份合同');
      return results();
    }catch(error){
      save('needs_reconciliation',step);
      if(step!=='authorization:preview')await page.close().catch(()=>{});
      throw error;
    }
  });
}
