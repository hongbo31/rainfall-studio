import type {Page} from 'playwright-core';
import type {FanqieAuthorizationPreference} from '../../shared/fanqie';

/** Prepare the observed authorization form only. Never click confirmation/signature controls. */
export async function prepareFanqieAuthorization(page:Page, title:string, preference:FanqieAuthorizationPreference,
  beforeWrite:(step:string)=>Promise<void>) {
  const guard=async()=>{
    const url=new URL(page.url());
    if(url.origin!=='https://www.novelfm.com'||url.pathname!=='/creator/music/finished/ugc/uploadProduct')throw Error('FANQIE_AUTHORIZATION_SCOPE_CHANGED');
    if(await page.getByRole('heading',{name:'授权信息·1',exact:true}).count()!==1||await page.getByText(title,{exact:true}).count()!==1)throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
  };
  if(!preference.confirmContractManually||!preference.platforms.includes('fanqie_music'))throw Error('FANQIE_AUTHORIZATION_PREFERENCE_INVALID');
  await guard();
  const write=async(step:string,action:()=>Promise<void>)=>{await guard();await beforeWrite('authorization:'+step);await guard();await action();};
  // The icon alt text "选择图标" is present even when unselected: explicitly choose the card.
  await write('mode',()=>page.getByText(preference.mode==='exclusive'?'独家授权':'非独家授权',{exact:true}).click());
  await write('identity-open',()=>page.getByPlaceholder('请选择签约身份').click());
  // Only the verified personal identity observed in this workflow is supported.
  const personal=page.getByRole('option',{name:'个人',exact:true});
  if(await personal.count()!==1)throw Error('FANQIE_AUTHORIZATION_IDENTITY_REQUIRED');
  await write('identity-personal',()=>personal.click());
  await write('platform-open',()=>page.locator('.platform-panel-trigger').click());
  const switches=page.getByRole('switch');
  if(await switches.count()!==2||await page.getByText('番茄畅听',{exact:true}).count()!==1)throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  if(!(await switches.nth(0).isChecked())||await switches.nth(0).isEnabled())throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  const audio=preference.platforms.includes('fanqie_audio');
  if(await switches.nth(1).isChecked()!==audio)await write('platform-audio',()=>switches.nth(1).click());
  if(await switches.nth(1).isChecked()!==audio)throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  await write('platform-close',()=>page.getByRole('heading',{name:'签约信息',exact:true}).click());
  const icons=await page.locator('.platform-panel-trigger img').evaluateAll(elements=>elements.map(e=>e.getAttribute('alt')).sort());
  if(JSON.stringify(icons)!==JSON.stringify((audio?['番茄音乐','番茄畅听']:['番茄音乐']).sort()))throw Error('FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED');
  if(!(await page.getByRole('button',{name:'下一步',exact:true}).isEnabled()))throw Error('FANQIE_AUTHORIZATION_INCOMPLETE');
  await write('preview',()=>page.getByRole('button',{name:'下一步',exact:true}).click());
  await page.getByRole('heading',{name:'确认签约协议',exact:true}).waitFor({state:'visible',timeout:20000});
  return {phase:'awaiting_signature' as const,contractAccepted:false as const};
}
