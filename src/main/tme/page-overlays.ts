import type {Page, Locator} from 'playwright-core';
import {runOverlayGuard,type OverlayKind,type ObservedOverlay} from './overlay-policy';

const homepage='https://y.tencentmusic.com/#/user/musician/index';
type Rule={id:string;kind:'notice'|'tour';observedRoute:string;container:string;headingSelector:string;heading:string;actionSelector?:string;actionRole?:'button';actionName:string};
// Captured from the actual homepage on 2026-10-18. These do not calibrate either upload route.
export const TME_OBSERVED_OVERLAY_RULES:readonly Rule[]=[
 {id:'musician-index-upgrade',kind:'notice',observedRoute:homepage,container:'.el-dialog[aria-modal="true"]',headingSelector:'.upgrade-dialog__content__title',heading:'音乐人指数全新改版',actionSelector:'.upgrade-dialog__content--arrow',actionName:''},
 {id:'musician-index-tour',kind:'tour',observedRoute:homepage,container:'#driver-popover-content.driver-popover[role="dialog"]',headingSelector:'#driver-popover-title',heading:'个人资料&资产',actionRole:'button',actionName:'跳过引导'},
 {id:'musician-ai-intro',kind:'notice',observedRoute:homepage,container:'.ai-ast__bubble.ai-ast__bubble--intro',headingSelector:'p.ai-ast__bubble-intro-desc',heading:'腾讯音乐人推出全新AI助手，提供智能数据、智能宣推、版权保护等全方位支持，快来尝试吧！',actionSelector:'span.ai-ast__bubble-close',actionName:''},
 {id:'musician-wechat-recommendation',kind:'notice',observedRoute:homepage,container:'.wechat-video-bind-float.wechat-video-bind-float--right',headingSelector:'.wvbf-title',heading:'绑定微信视频号，歌曲推广更便捷',actionSelector:'.wvbf-footer button.wvbf-btn-secondary',actionName:'稍后再说'},
];
export type OverlayRow={instanceId:string;ruleId?:string;heading:string;text:string;actionName:string;actionCount:number;visible:boolean;role:string;editable:boolean;blocking?:boolean;modal?:boolean};
const protectedKind=(text:string):OverlayKind|null=>{
 if(/未保存|尚未保存|放弃(?:编辑|修改)|退出(?:编辑|上传)|离开此页面/.test(text))return 'unsaved';
 if(/删除|移除作品/.test(text))return 'delete';
 if(/验证码|安全验证|滑块|人机验证/.test(text))return 'captcha';
 if(/登录|登陆|扫码/.test(text))return 'login';
 if(/协议|条款|授权|签约|同意/.test(text))return 'terms';
 if(/权限|允许访问|允许使用|允许通知/.test(text))return 'permission';
 return null;
};
export function classifyTmeOverlays(route:string,rows:OverlayRow[]):ObservedOverlay[]{
 return rows.map(row=>{
  const rule=TME_OBSERVED_OVERLAY_RULES.find(x=>x.id===row.ruleId);
  const isOverlay=row.modal===true||!!rule||['dialog','alertdialog','mask'].includes(row.role);
  const sensitive=isOverlay&&!row.editable?protectedKind(row.text):null;
  const verified=!!rule&&route===rule.observedRoute&&row.visible&&!row.editable&&!sensitive&&row.heading===rule.heading&&row.actionName===rule.actionName&&row.actionCount===1;
  return{instanceId:row.instanceId,ruleId:row.ruleId,kind:sensitive??(verified?rule!.kind:'unknown'),visible:row.visible,blocking:row.blocking??isOverlay,verified,actionCount:row.actionCount};
 });
}

export type OverlayPageScope={subject:string;binding:string;materials:string};
/** Main-owned DOM adapter. Recognition alone never enables a publishing contract. */
export class TmePageOverlayGuard {
 private busy=false;
 private nativeDialog=false;
 private paused:Error|null=null;
 private attemptedRules=new Set<string>();
 constructor(private page:Page,private readScope:()=>Promise<OverlayPageScope>,private now:()=>number=()=>performance.now()){
  // Never auto-dismiss browser confirms, beforeunload, login or other native dialogs.
  // A manual resolution requires a fresh reviewed guard instance; no silent reset.
  page.on('dialog',()=>{this.nativeDialog=true});
 }
 private check(){if(this.nativeDialog)throw Error('PAGE_NATIVE_DIALOG_REQUIRES_USER')}
 private async scan(){
  this.check();
  const result=await this.page.evaluate((rules)=>{
   const visible=(el:Element)=>{
    if(!el.isConnected)return false;
    for(let n:Element|null=el;n;n=n.parentElement){const style=getComputedStyle(n);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0||n.getAttribute('aria-hidden')==='true')return false;}
    return el.getClientRects().length>0;
   };
   const path=(el:Element)=>{const parts:string[]=[];for(let n:Element|null=el;n&&n!==document.body;n=n.parentElement){const siblings=n.parentElement?Array.from(n.parentElement.children):[n];parts.unshift(n.tagName+':'+siblings.indexOf(n));}return parts.join('/')};
   const nodes=new Set<Element>();for(const rule of rules)for(const el of document.querySelectorAll(rule.container))nodes.add(el);
   for(const el of document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],.el-dialog,.driver-popover'))nodes.add(el);
   const rows:OverlayRow[]=[];
   for(const el of nodes){
    if(!visible(el))continue;
    const matches=rules.filter(rule=>el.matches(rule.container));
    const rule=matches.length===1?matches[0]:undefined;
    const headings=rule?Array.from(el.querySelectorAll(rule.headingSelector)).filter(visible):[];
    const actions=rule?(rule.actionSelector?Array.from(el.querySelectorAll(rule.actionSelector)):Array.from(el.querySelectorAll('button,[role="button"]')).filter(x=>x.textContent?.trim()===rule.actionName)).filter(visible).filter(x=>!x.hasAttribute('disabled')&&x.getAttribute('aria-disabled')!=='true'):[];
    const clone=el.cloneNode(true) as Element;for(const editable of clone.querySelectorAll('input,textarea,[contenteditable="true"]'))editable.remove();
    rows.push({instanceId:(rule?.id??'unknown')+':'+path(el),ruleId:rule?.id,heading:headings.length===1?headings[0].textContent?.trim()??'':'',text:clone.textContent?.trim()??'',actionName:actions.length===1?(rule?.actionName?actions[0].textContent?.trim()??'':''):'',actionCount:actions.length,visible:true,modal:el.matches('[aria-modal="true"],.el-dialog,.driver-popover'),role:el.getAttribute('role')??(el.matches('[aria-modal="true"],.el-dialog,.driver-popover')?'dialog':'container'),editable:!!el.closest('input,textarea,[contenteditable="true"]')});
   }
   const masks=Array.from(document.querySelectorAll('.v-modal,.el-overlay,.driver-overlay')).filter(visible);
   if(masks.length&&!rows.some(x=>x.role==='dialog'||x.role==='alertdialog'))rows.push({instanceId:'orphan-backdrop',heading:'',text:'',actionName:'',actionCount:0,visible:true,role:'mask',editable:false});
   return{route:location.href,rows,ready:document.readyState!=='loading'};
  },TME_OBSERVED_OVERLAY_RULES);
  this.check();return result;
 }
 private async observe(){
  const raw=await this.scan(),scope=await this.readScope();this.check();
  if(this.page.url()!==raw.route)throw Error('PAGE_OVERLAY_SCOPE_CHANGED');
  return{scope:{origin:new URL(raw.route).origin,route:raw.route,...scope},overlays:classifyTmeOverlays(raw.route,raw.rows),scanComplete:raw.ready};
 }
 private action(container:Locator,rule:Rule){return rule.actionSelector?container.locator(rule.actionSelector).filter({visible:true}):container.getByRole('button',{name:rule.actionName,exact:true}).filter({visible:true})}
 async run(){
  if(this.busy)throw Error('PAGE_OVERLAY_BUSY');if(this.paused)throw this.paused;this.busy=true;
  try{return await runOverlayGuard({now:this.now,observe:()=>this.observe(),guard:()=>this.check(),dismiss:async (target,context)=>{
   const deadline=this.now()+context.timeoutMs;
   this.check();const rule=TME_OBSERVED_OVERLAY_RULES.find(x=>x.id===target.ruleId);
   if(!rule||this.page.url()!==rule.observedRoute)throw Error('PAGE_OVERLAY_SCOPE_CHANGED');
   const container=this.page.locator(rule.container).filter({visible:true});
   if(await container.count()!==1)throw Error('PAGE_OVERLAY_CONTROL_CHANGED');
   const heading=container.locator(rule.headingSelector).filter({visible:true});
   if(await heading.count()!==1||(await heading.innerText({timeout:1500})).trim()!==rule.heading)throw Error('PAGE_OVERLAY_CONTROL_CHANGED');
   const action=this.action(container,rule);if(await action.count()!==1||!await action.isEnabled())throw Error('PAGE_OVERLAY_CONTROL_CHANGED');
   const fresh=await this.observe();
   if(Object.entries(context.scope).some(([key,value])=>fresh.scope[key as keyof typeof fresh.scope]!==value))throw Error('PAGE_OVERLAY_SCOPE_CHANGED');
   const candidates=fresh.overlays.filter(x=>x.visible&&x.blocking);
   if(candidates.some(x=>!x.verified)||!candidates.some(x=>x.instanceId===target.instanceId&&x.ruleId===target.ruleId))throw Error('PAGE_OVERLAY_CONTROL_CHANGED');
   this.check();if(this.page.url()!==rule.observedRoute)throw Error('PAGE_OVERLAY_SCOPE_CHANGED');
   const remaining=deadline-this.now();if(remaining<=0)throw Error('OVERLAY_TIMEOUT');
   if(this.attemptedRules.has(rule.id))throw Error('OVERLAY_REPEATED');
   this.attemptedRules.add(rule.id);
   await action.click({timeout:Math.min(1500,remaining)}); // No force, coordinates, generic X, accept, next or retry.
  }})}catch(error){this.paused=error instanceof Error?error:Error('PAGE_OVERLAY_UNKNOWN');throw this.paused}finally{this.busy=false}
 }
}
