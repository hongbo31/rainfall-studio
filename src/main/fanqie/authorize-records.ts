import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {BrowserContext,Page} from 'playwright-core';
import {fanqieOrigin,type FanqieAuthorizationPreference,type FanqieAuthorizationResult} from '../../shared/fanqie';
import {assertFanqieCatalogUrl,fanqieCatalogPath,fanqieWorkIdTextPattern,type FanqieCatalogRow} from '../../shared/fanqie-catalog';
import {FanqieCatalogSession} from './catalog-session';
import {readFanqieCatalogPages,readFanqieCatalogWork} from './catalog';
import {assertFanqieAuthorizationLocation,generateFanqieUnsignedContract,prepareFanqieAuthorization} from './authorization';
import {fanqieDirectoryStartTab} from './directory-page';
import {fanqieContractUrl,isFanqieAuthorizationPage,openFanqieContractLink,type FanqieExistingSigningPage} from './directory-signature';
import type {FanqieDirectoryTracePort} from './directory-trace';

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
const previewSteps=new Set(['authorization:preview','authorization:confirm-sync','authorization:generate-contract']);

function verifyPending(pending:readonly Work[],latest:FanqieCatalogRow[]){
  for(const {id,title} of pending){
    // The official add-song picker only displays titles. Require a unique pending record for each.
    const titled=latest.filter(row=>row.title===title);
    if(titled.some(row=>row.stage==='unknown'))throw Error('FANQIE_CATALOG_STATUS_UNVERIFIED');
    const matches=titled.filter(row=>row.stage==='contract_pending');
    if(matches.length!==1||matches[0].id!==id||latest.filter(row=>row.id===id).length!==1)
      throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
  }
}

export async function authorizeFanqieRecords(
  root:string,session:FanqieCatalogSession,accountKey:string,ids:string[],
  preference:FanqieAuthorizationPreference,outerGuard:()=>void|Promise<void>,
  stateDirectory=path.join(root,'production','fanqie'),
  wholeBatch=false,
  options:{uploadedPage?:Page;trace?:FanqieDirectoryTracePort;onPreview?:(page:Page,signing?:FanqieExistingSigningPage)=>void;
    records?:readonly Work[];uploadedTitles?:readonly string[];resume?:boolean;directPreview?:boolean;
    beforeGenerate?:(page:Page)=>void|Promise<void>}={},
):Promise<FanqieAuthorizationResult[]> {
  const {uploadedPage,trace,onPreview,records:expectedRecords,uploadedTitles,resume,directPreview,beforeGenerate}=options;
  if(resume&&(!expectedRecords||uploadedPage||!wholeBatch))throw Error('FANQIE_AUTHORIZATION_SCOPE_CHANGED');
  if(beforeGenerate&&(!directPreview||!expectedRecords||!wholeBatch))throw Error('FANQIE_AUTHORIZATION_SCOPE_CHANGED');
  if(uploadedTitles&&(!uploadedPage||uploadedTitles.length!==ids.length))throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
  const namesById=expectedRecords&&new Map(expectedRecords.map(record=>[record.id,record.title]));
  const observed=async<T>(step:string,action:()=>Promise<T>,page?:Page)=>{
    await trace?.trace(step,'begin',page);
    try{
      const result=await action();
      await trace?.trace(step,'ok',page);
      return result;
    }catch(error){await trace?.trace(step,'error',page,undefined,error);throw error;}
  };
  return session.run(async(context,guard)=>{
    const inspect=async()=>{
      guard();await outerGuard();guard();
      const current=await session.inspect(context,guard,false,trace,expectedRecords?.map(({title})=>({title})));
      await outerGuard();guard();
      if(!current.catalog.complete||current.report.accountKey!==accountKey)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
      return current.catalog.rows;
    };
    const {catalog,rows,pending}=await observed('authorization:check-receipts',async()=>{
      if(uploadedPage&&(uploadedPage.context()!==context||uploadedPage.isClosed()))
        throw Error('FANQIE_AUTHORIZATION_SCOPE_CHANGED');
      if(uploadedPage&&(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!/^[1-9]\d{4,24}$/u.test(id))))
        throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
      if(namesById&&(namesById.size!==ids.length||ids.some(id=>!namesById.get(id))))
        throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
      const catalog=await inspect();
      const rows=ids.map(id=>{
        const row=catalog.find(row=>row.id===id);
        if(!row)throw Error('FANQIE_JOB_NOT_FOUND');
        if(namesById&&namesById.get(id)!==row.title)throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
        if(row.stage==='unknown')throw Error('FANQIE_CATALOG_STATUS_UNVERIFIED');
        return row;
      });
      const pending=rows.filter(row=>row.stage==='contract_pending');
      if((wholeBatch||uploadedPage)&&pending.length&&pending.length!==rows.length)
        throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
      verifyPending(pending,catalog);
      return {catalog,rows,pending};
    });
    const results=():FanqieAuthorizationResult[]=>rows.map(row=>({
      id:row.id,title:row.title,
      status:row.stage==='contract_pending'?'等待合同确认':row.officialStatus,
      phase:row.stage==='contract_pending'?'awaiting_signature':'already_processed',
    }));
    if(!pending.length)return results();
    const contractStage=pending.map(row=>row.contract);
    const uncreated=contractStage.every(contract=>contract?.state==='not_created');
    const contractIds=contractStage.map(contract=>contract?.state==='awaiting_signature'?contract.id:undefined);
    const contractId=resume&&contractIds[0]&&contractIds.every(id=>id===contractIds[0])?contractIds[0]:undefined;
    if(resume&&!uncreated&&!contractId)throw Error('FANQIE_EXISTING_CONTRACT_UNVERIFIED');

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
    const presentPreview=async(page:Page)=>{
      if(!beforeGenerate){onPreview?.(page);await page.bringToFront();return;}
      const step='authorization:generate-contract';
      await observed(step,()=>generateFanqieUnsignedContract(page,async()=>{
        const latest=await inspect();
        verifyPending(pending,latest);
        if(!pending.every(work=>latest.some(row=>row.id===work.id&&row.contract?.state==='not_created')))
          throw Error('FANQIE_EXISTING_CONTRACT_UNVERIFIED');
        save('awaiting_signature',step);
        await beforeGenerate(page);
        guard();await outerGuard();guard();
      }),page);
    };

    let foundPreview=false;
    for(const name of fs.readdirSync(folder)){
      if(!name.startsWith(prefix)||!/^([1-9]\d{4,24}|batch-[a-f0-9]{64})\.json$/.test(name.slice(prefix.length)))continue;
      const previous=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8')) as Journal;
      const works=previous.records??[{id:previous.id,title:previous.title}];
      if(!works.some(work=>work.id&&pendingIds.has(work.id))||
          (previous.phase!=='awaiting_signature'&&!previewSteps.has(previous.step??'')))continue;
      if(name!==filename||previous.accountKey!==accountKey||JSON.stringify(works)!==JSON.stringify(records)||
          JSON.stringify(previous.preference)!==JSON.stringify(preference))
        throw Error('FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED');
      foundPreview=true;
    }

    if(foundPreview&&!contractId){
      const existing=preparedPages.get(context)?.get(file);
      const reusable=existing&&isFanqieAuthorizationPage(existing)&&(!uploadedPage||existing===uploadedPage)&&
        await existing.getByRole('heading',{name:'确认签约协议',exact:true}).isVisible()&&
        await existing.getByRole('button',{name:'确认签署',exact:true}).isVisible();
      if(reusable)return observed('authorization:reuse-preview',async()=>{
        assertFanqieAuthorizationLocation(existing,!!uploadedPage);
        await presentPreview(existing);
        return results();
      },existing);
      if(!resume)throw Error('FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED');
    }

    if(contractId){
      const url=fanqieContractUrl(contractId);
      const page=context.pages().find(page=>!page.isClosed()&&page.url()===url)??await fanqieDirectoryStartTab(context);
      const detach=trace?.watch(page);
      try{
        return await observed('authorization:resume-existing-contract',async()=>{
          const signing=await openFanqieContractLink(page,contractId,records,async()=>{
            const latest=await inspect();
            verifyPending(pending,latest);
            if(!pending.every(work=>latest.some(row=>row.id===work.id&&row.contract?.state==='awaiting_signature'&&
                row.contract.id===contractId)))throw Error('FANQIE_EXISTING_CONTRACT_UNVERIFIED');
            guard();
          });
          save('awaiting_signature','authorization:existing-contract-link');
          onPreview?.(page,signing);
          await signing.popup.bringToFront();
          session.mark('已打开本批签约页');
          return results();
        },page);
      }finally{detach?.();}
    }

    const page=uploadedPage??await observed('authorization:select-page',
      ()=>expectedRecords?fanqieDirectoryStartTab(context):context.newPage());
    const detach=trace?.watch(page);
    const anchor=catalog.find(row=>pendingIds.has(row.id))!;
    let step=uploadedPage?'authorization:verify-upload-page':'open-catalog';
    try{
      save('preparing',step);
      session.mark('正在准备 '+pending.length+' 首作品的授权');
      const beforeWrite=async(next:string)=>{
        const latest=await inspect();
        verifyPending(pending,latest);
        if((resume||uncreated)&&!pending.every(work=>latest.some(row=>row.id===work.id&&row.contract?.state==='not_created')))
          throw Error('FANQIE_EXISTING_CONTRACT_UNVERIFIED');
        step=next;
        save('preparing',step);
      };
      const modeHeading=page.getByRole('heading',{name:'选择签约模式',exact:true});
      if(uploadedPage){
        await observed(step,async()=>{
          assertFanqieAuthorizationLocation(page,true);
          await modeHeading.waitFor({state:'visible',timeout:20000});
          assertFanqieAuthorizationLocation(page,true);
        },page);
      }else{
        const target=await observed('authorization:open-catalog',async()=>{
          await page.goto(fanqieOrigin+fanqieCatalogPath,{waitUntil:'domcontentloaded',timeout:20000});
          const idText=fanqieWorkIdTextPattern(anchor.id);
          const target=page.getByRole('row').filter({has:page.getByText(idText)});
          if(!await target.count()){
            if(expectedRecords){
              const search=page.getByPlaceholder('请输入作品名称',{exact:true}).filter({visible:true});
              await search.waitFor({state:'visible',timeout:10000});
              guard();assertFanqieCatalogUrl(page.url());
              await search.fill(anchor.title);
            }else if(catalog.length>1)await readFanqieCatalogPages(page,guard,anchor.id);
          }
          await target.waitFor({state:'visible',timeout:20000});
          return target;
        },page);
        await observed('authorization:open-existing',async()=>{
          await beforeWrite('open-existing');
          assertFanqieCatalogUrl(page.url());
          if(await target.count()!==1)throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
          const work=await readFanqieCatalogWork(target);
          if(work.title!==anchor.title||work.id!==anchor.id||work.stage!=='contract_pending')
            throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
          guard();assertFanqieCatalogUrl(page.url());
          await target.locator('svg.serial-fm-icon-general_edit').click();
          await modeHeading.waitFor({state:'visible',timeout:20000});
        },page);
      }
      const titles=uploadedPage?(uploadedTitles??pending.map(row=>row.title)):
        [anchor.title,...pending.filter(row=>row.id!==anchor.id).map(row=>row.title)];
      await prepareFanqieAuthorization(page,titles,preference,beforeWrite,{fromUpload:!!uploadedPage,directPreview,trace});
      return await observed('authorization:show-preview',async()=>{
        save('awaiting_signature','authorization:preview');
        let pages=preparedPages.get(context);
        if(!pages){pages=new Map();preparedPages.set(context,pages);}
        pages.set(file,page);
        await presentPreview(page);
        session.mark(beforeGenerate?'已请求生成本批合同':pending.length+' 首作品待确认同一份合同');
        return results();
      },page);
    }catch(error){
      save('needs_reconciliation',step);
      if(!uploadedPage&&!expectedRecords&&!previewSteps.has(step))await page.close().catch(()=>{});
      throw error;
    }finally{detach?.();}
  });
}
