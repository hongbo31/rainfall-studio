import type {Page} from 'playwright-core';
import type {FanqieAuthorizationPreference} from '../../shared/fanqie';

/** Prepare the observed authorization form only. Never click confirmation/signature controls. */
export async function prepareFanqieAuthorization(page:Page, title:string, preference:FanqieAuthorizationPreference,
  beforeWrite:(step:string)=>Promise<void>) {
  const assertLocation=()=>{
    const url=new URL(page.url());
    if(url.origin!=='https://www.novelfm.com'||url.pathname!=='/creator/music/finished/ugc/uploadProduct'||url.username||url.password)
      throw Error('FANQIE_AUTHORIZATION_SCOPE_CHANGED');
  };
  const heading=page.getByRole('heading',{name:/^授权信息\s*[·・]\s*1$/u});
  const songs=page.locator('.auth-rights-list .auth-right-item .song-name').filter({visible:true});
  const guard=async()=>{
    assertLocation();
    if(await heading.count()!==1||await songs.count()!==1||(await songs.innerText()).trim()!==title)
      throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
    assertLocation();
  };
  if(!preference.confirmContractManually||!preference.platforms.includes('fanqie_music'))throw Error('FANQIE_AUTHORIZATION_PREFERENCE_INVALID');
  assertLocation();
  // The mode heading renders before the asynchronous rights list.
  await heading.waitFor({state:'visible',timeout:20000});
  await songs.waitFor({state:'visible',timeout:20000});
  await guard();
  const write=async(step:string,action:()=>Promise<void>)=>{await guard();await beforeWrite('authorization:'+step);await guard();await action();};
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
  assertLocation();
  return {phase:'awaiting_signature' as const,contractAccepted:false as const};
}
