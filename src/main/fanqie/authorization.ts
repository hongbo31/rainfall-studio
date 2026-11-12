import type {Page} from 'playwright-core';
import type {FanqieAuthorizationPreference} from '../../shared/fanqie';

export function assertFanqieAuthorizationLocation(page:Page) {
  const url=new URL(page.url());
  if(url.origin!=='https://www.novelfm.com'||url.pathname!=='/creator/music/finished/ugc/uploadProduct'||url.username||url.password)
    throw Error('FANQIE_AUTHORIZATION_SCOPE_CHANGED');
}

/** Select the requested works and options, then stop at the official contract preview. */
export async function prepareFanqieAuthorization(page:Page, titles:readonly string[], preference:FanqieAuthorizationPreference,
  beforeWrite:(step:string)=>Promise<void>) {
  const heading=(count:number)=>page.getByRole('heading',{name:new RegExp('^授权信息\\s*[·・]\\s*'+count+'$','u')});
  const rights=page.locator('.auth-rights-list .auth-right-item').filter({visible:true});
  const songs=rights.locator('.song-name').filter({visible:true});
  const guard=async(expected:readonly string[])=>{
    assertFanqieAuthorizationLocation(page);
    const observed=(await songs.allInnerTexts()).map(title=>title.trim()).sort();
    if(await heading(expected.length).count()!==1||JSON.stringify(observed)!==JSON.stringify([...expected].sort()))
      throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
    assertFanqieAuthorizationLocation(page);
  };
  if(!titles.length||new Set(titles).size!==titles.length)throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
  if(!preference.confirmContractManually||!preference.platforms.includes('fanqie_music'))throw Error('FANQIE_AUTHORIZATION_PREFERENCE_INVALID');
  assertFanqieAuthorizationLocation(page);
  // The mode heading renders before the asynchronous rights list.
  const anchor=[titles[0]];
  await heading(1).waitFor({state:'visible',timeout:20000});
  await songs.first().waitFor({state:'visible',timeout:20000});
  await guard(anchor);
  if(titles.length>1){
    await beforeWrite('authorization:open-picker');
    await guard(anchor);
    await page.getByRole('button',{name:'添加未授权歌曲',exact:true}).click();
    const confirm=page.getByRole('button',{name:'确认添加',exact:true});
    await confirm.waitFor({state:'visible',timeout:15000});
    const list=page.getByRole('list').filter({has:page.getByRole('checkbox')}).filter({visible:true});
    const pickerRow=(title:string)=>list.locator('.unauth-song-item').filter({has:page.getByText(title,{exact:true})});
    const selectionCount=page.getByText(/^[（(]\s*已选\s*\d+\s*首\s*[)）]$/u).filter({visible:true});
    const verifyCount=async(count:number)=>{
      const expected=new RegExp('^[（(]\\s*已选\\s*'+count+'\\s*首\\s*[)）]$','u');
      const labels=await selectionCount.allInnerTexts();
      if(!labels.length||!labels.every(text=>expected.test(text.trim())))
        throw Error('FANQIE_AUTHORIZATION_PICKER_MISMATCH');
    };
    await selectionCount.first().waitFor({state:'visible',timeout:15000});
    await pickerRow(titles[0]).first().waitFor({state:'visible',timeout:15000});
    // Fanqie can render the anchor both as the current work and in the pending list.
    const anchorChecks=await pickerRow(titles[0]).getByRole('checkbox').all();
    if(!anchorChecks.length||!(await Promise.all(anchorChecks.map(checkbox=>checkbox.isChecked()))).every(Boolean))
      throw Error('FANQIE_AUTHORIZATION_PICKER_MISMATCH');
    await verifyCount(1);
    await beforeWrite('authorization:select-songs');
    for(const title of titles.slice(1)){
      const row=pickerRow(title);
      if(!await row.count()){
        // The virtual list loads other works after opening and mounts rows as it scrolls.
        await list.evaluate(el=>{el.scrollTop=0;});
        const deadline=Date.now()+15000;
        while(Date.now()<deadline&&!await row.count()){
          assertFanqieAuthorizationLocation(page);
          await list.evaluate(el=>{el.scrollTop+=Math.max(1,Math.floor(el.clientHeight*0.8));});
          await new Promise(resolve=>setTimeout(resolve,200));
        }
      }
      await guard(anchor);
      const checkbox=row.getByRole('checkbox'),label=row.locator('label.arco-checkbox');
      if(await row.count()!==1||await checkbox.count()!==1||await label.count()!==1||await checkbox.isChecked())
        throw Error('FANQIE_AUTHORIZATION_PICKER_MISMATCH');
      await label.click();
      if(!(await checkbox.isChecked()))throw Error('FANQIE_AUTHORIZATION_PICKER_MISMATCH');
    }
    await beforeWrite('authorization:add-songs');
    await guard(anchor);
    await verifyCount(titles.length);
    await confirm.click();
    await confirm.waitFor({state:'hidden',timeout:15000});
    const duplicatedHeading=heading(titles.length+1);
    await heading(titles.length).or(duplicatedHeading).waitFor({state:'visible',timeout:15000});
    if(await duplicatedHeading.isVisible()){
      // The official picker can add the current work twice. Remove one copy from
      // the authorization list only after proving there is exactly one duplicate.
      const duplicated=[...titles,titles[0]];
      await songs.nth(duplicated.length-1).waitFor({state:'visible',timeout:15000});
      await guard(duplicated);
      await beforeWrite('authorization:remove-duplicate');
      await guard(duplicated);
      const copies=rights.filter({has:page.getByText(titles[0],{exact:true})});
      const remove=copies.last().locator('.rights-selection svg.serial-fm-icon-general_delete.delete-icon');
      if(await copies.count()!==2||await remove.count()!==1)throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
      await remove.click();
    }
    await heading(titles.length).waitFor({state:'visible',timeout:15000});
    await songs.nth(titles.length-1).waitFor({state:'visible',timeout:15000});
  }
  await guard(titles);
  const write=async(step:string,action:()=>Promise<void>)=>{
    await guard(titles);await beforeWrite('authorization:'+step);await guard(titles);await action();
  };
  const modeTitle=preference.mode==='exclusive'?'独家授权':'非独家授权';
  const modeCard=page.locator('.auth-type-card').filter({has:page.getByText(modeTitle,{exact:true})});
  await write('mode',()=>modeCard.click());
  if(await modeCard.and(page.locator('.selected')).count()!==1)throw Error('FANQIE_AUTHORIZATION_MODE_UNVERIFIED');
  const identity=page.getByRole('combobox').and(page.locator('#sign_identity_input'));
  const identityLabel=page.locator('label[for="sign_identity_input"]');
  if(await identityLabel.count()!==1||(await identityLabel.innerText()).trim()!=='签约身份')
    throw Error('FANQIE_AUTHORIZATION_IDENTITY_REQUIRED');
  const selectedPersonal=identity.getByText('个人',{exact:true}).filter({visible:true});
  if(await selectedPersonal.count()!==1){
    await write('identity-open',()=>identity.click());
    const personal=page.getByRole('option',{name:'个人',exact:true});
    await personal.waitFor({state:'visible',timeout:10000});
    await write('identity-personal',()=>personal.click());
    if(await selectedPersonal.count()!==1)throw Error('FANQIE_AUTHORIZATION_IDENTITY_REQUIRED');
  }
  await write('platform-open',()=>page.locator('.platform-panel-trigger').click());
  const panel=page.locator('.platform-panel-panel').filter({visible:true});
  const platformSwitch=(name:string)=>panel.locator('.platform-panel-item').filter({
    has:page.getByText(name,{exact:true}),
  }).getByRole('switch');
  const musicSwitch=platformSwitch('番茄音乐'),audioSwitch=platformSwitch('番茄畅听');
  if(await panel.getByRole('switch').count()!==2||await musicSwitch.count()!==1||await audioSwitch.count()!==1)
    throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  if(!(await musicSwitch.isChecked())||await musicSwitch.isEnabled())throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  const audio=preference.platforms.includes('fanqie_audio');
  if(await audioSwitch.isChecked()!==audio)await write('platform-audio',()=>audioSwitch.click());
  if(await audioSwitch.isChecked()!==audio)throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  await write('platform-close',()=>page.getByRole('heading',{name:'签约信息',exact:true}).click());
  const icons=await page.locator('.platform-panel-trigger img').evaluateAll(elements=>elements.map(e=>e.getAttribute('alt')).sort());
  if(JSON.stringify(icons)!==JSON.stringify((audio?['番茄音乐','番茄畅听']:['番茄音乐']).sort()))throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  if(!(await page.getByRole('button',{name:'下一步',exact:true}).isEnabled()))throw Error('FANQIE_AUTHORIZATION_INCOMPLETE');
  await write('preview',()=>page.getByRole('button',{name:'下一步',exact:true}).click());
  await page.getByRole('heading',{name:'确认签约协议',exact:true}).waitFor({state:'visible',timeout:20000});
  assertFanqieAuthorizationLocation(page);
  return {phase:'awaiting_signature' as const,contractAccepted:false as const};
}
