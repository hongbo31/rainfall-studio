import type {Page} from 'playwright-core';
import {createHash} from 'node:crypto';
const profileRoute='https://y.tencentmusic.com/#/user/musician/edit';
// Observed on the official profile page, 2026-10-18. This calibrates READS only.
const evidence={route:profileRoute,tab:'绑定其他平台账号',artist:'.mod_top_login .top_login__links .name',row:'.account-item',label:'.account-item-content-label',value:'.account-item-content-value',observedOn:'2026-10-18'};
export const TME_READONLY_IDENTITY_EVIDENCE_HASH=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
export async function readOfficialProfileIdentity(page:Page){
 if(page.url()!==profileRoute)throw Error('BROWSER_ACCOUNT_PROFILE_REQUIRED');
 const raw=await page.evaluate((c)=>{
  const visible=(el:Element)=>{if(!el.isConnected||!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
  const text=(el:Element)=>(el as HTMLElement).innerText.trim().replace(/\s+/g,' ');
  const matching=(selector:string,root:Element|Document=document)=>Array.from(root.querySelectorAll(selector)).filter(visible);
  const tabs=matching('[role="tab"][aria-selected="true"]');
  if(tabs.length!==1||text(tabs[0])!==c.tab)return{error:'BROWSER_ACCOUNT_PROFILE_REQUIRED'};
  const artists=matching(c.artist),rows=matching(c.row);
  const row=(label:string)=>rows.filter(r=>{const labels=matching(c.label,r);return labels.length===1&&text(labels[0])===label;});
  const qq=row('QQ音乐'),kg=row('酷狗音乐');
  if(artists.length!==1||qq.length!==1||kg.length!==1)return{error:'BROWSER_ACCOUNT_IDENTITY_UNVERIFIED'};
  const q=matching(c.value,qq[0]),values=matching(c.value,kg[0]).map(text);
  const k=values.filter(t=>/^已绑定酷狗ID[：:]/.test(t)),linked=values.filter(t=>/^已绑定酷狗音乐推ID[：:]/.test(t));
  if(q.length!==1||k.length!==1||linked.length!==1)return{error:'BROWSER_ACCOUNT_IDENTITY_UNVERIFIED'};
  return{artistName:text(artists[0]),qqLine:text(q[0]),kugouLine:k[0],linkedLine:linked[0]};
 },evidence);
 if(page.url()!==profileRoute)throw Error('BROWSER_ACCOUNT_PROFILE_REQUIRED');
 if(raw.error)throw Error(raw.error);
 const k=/^已绑定酷狗ID[：:]\s*(\d{5,30})$/.exec(raw.kugouLine??''),linked=/^已绑定酷狗音乐推ID[：:]\s*(\d{5,30})(?:\s*[（(]酷狗音乐关联[）)])?$/.exec(raw.linkedLine??''),q=/^已绑定个人账号[：:]\s*(\S.{0,200})$/.exec(raw.qqLine??'');
 if(!k||!linked||k[1]!==linked[1]||!q||!raw.artistName||raw.artistName.length>200)throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
 return{kugouId:k[1],qqDisplayName:q[1].trim(),artistName:raw.artistName};
}
