import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {Frame,Page} from 'playwright-core';
import {fanqieOrigin} from '../../shared/fanqie';
import {directoryInlineError, directoryPageError} from './directory-validation';
import {fanqieBrowserFailureCode} from './browser-errors';

type Event = 'begin'|'ok'|'error';
const countKeys = ['configuredArtistCount','rootEntryCount','accountDirectoryCount','matchedArtistDirectoryCount',
  'scannedArtistDirectoryCount','audioCandidateCount','candidateCount','readyCount','batchLimit','batchSize','submittedCount',
  'accountIdentityChecks','submissionRejectionWaitMs','noticeCount','matchCount','retryLimit','removedCount',
  'newRecordCount','deletedMaterialCount'] as const;
export type FanqieDirectoryTraceDetails = Partial<Record<typeof countKeys[number],number>> & {
  songTitle?:string;
  issueCounts?:Record<string,number>;
};
export type FanqieDirectoryTracePort = {
  trace:(step:string,phase:Event,page?:Page,songIndex?:number,error?:unknown,details?:FanqieDirectoryTraceDetails)=>Promise<void>|void;
  watch:(page:Page)=>()=>void;
  /** Register the exact HTTPS document whose origin and connection to this round the caller verified. */
  watchSigningPage?:(page:Page,verifiedUrl:string)=>()=>void;
};

const visibleErrorCodes = [
  'FANQIE_ARCO_INLINE_ERROR', 'FANQIE_ARCO_TOAST_ERROR', 'FANQIE_FORM_VALIDATION_ERROR',
  'FANQIE_PAGE_ALERT_ERROR', 'FANQIE_VISIBLE_ERRORS_OVERFLOW',
] as const;
const songField = /^songs_(\d+)_(name|type|ai_usage_type|instrumental|lyricist_id_list|composer_id_list|singer_id_list|songFile|lyricFile|coverImage|authorizationFiles|copyrightFile)(?:_input)?$/u;
type PageErrorRegion = {x:number;y:number;width:number;height:number;caption:number};
type VisibleError = {code:typeof visibleErrorCodes[number];control?:string;region?:PageErrorRegion};
type Step = { step:string; songIndex:number|null };
type PageSteps = {open:Step[];recent:Step};
type TraceEntry = Step & { event:Event; code?:string; field?:string; details?:FanqieDirectoryTraceDetails; failure?:{name:string;message:string;causeName?:string;browserCode?:string;httpStatus?:number;playwrightOperation?:string;waitApi?:string;timeoutBudgetMs?:number} };
type SigningScope = {url:string; state:'active'|'navigated'|'detached'};
type SigningRegion = {x:number;y:number;width:number;height:number;caption:number;error:boolean};
type SigningError = {code:typeof signingErrorCodes[number];region?:SigningRegion};
type SigningDiagnostics = {width:number;height:number;regions:SigningRegion[];events:SigningError[]};
type SigningCapture = {scope:SigningScope;region?:SigningRegion};
type ScreenshotEvidence = {signing?:SigningCapture;alert?:PageErrorRegion};
type PageWatcher = {references:number;flush:()=>Promise<void>;stop:()=>void};
const activeWrites=new Map<string,Promise<void>>();
function traceKey(file:string){const resolved=path.resolve(file);return process.platform==='win32'?resolved.toLowerCase():resolved;}

/** Remove expired diagnostic rows while serializing against this trace's pending writes. */
export function pruneFanqieTraceFile(file:string,cutoff:number):Promise<boolean>{
  const resolved=path.resolve(file),key=traceKey(resolved),previous=activeWrites.get(key)??Promise.resolve();
  const operation=previous.then(()=>{
    let stat:fs.Stats;
    try{stat=fs.lstatSync(resolved);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())return false;
    const source=fs.readFileSync(resolved,'utf8');
    const lines=source.split(/\r?\n/u).filter(Boolean),retained:string[]=[];
    for(const line of lines){
      try{
        const row=JSON.parse(line) as {at?:unknown};
        const at=typeof row.at==='string'?Date.parse(row.at):NaN;
        if(Number.isFinite(at)&&at>=cutoff)retained.push(line);
      }catch{/* Drop malformed rows because their age cannot be established. */}
    }
    if(retained.length===lines.length)return false;
    if(!retained.length){fs.unlinkSync(resolved);return true;}
    const temporary=resolved+'.retention-'+randomUUID()+'.tmp';
    try{
      fs.writeFileSync(temporary,retained.join('\n')+'\n',{encoding:'utf8',flag:'wx',flush:true});
      fs.renameSync(temporary,resolved);
    }finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}}
    return true;
  });
  const settled=operation.then(()=>undefined,()=>undefined);
  activeWrites.set(key,settled);
  void settled.then(()=>{if(activeWrites.get(key)===settled)activeWrites.delete(key);});
  return operation;
}
const toast=directoryPageError;
const inline=directoryInlineError+',.arco-upload-list-item-error';
const validation=':is(form,.arco-form) :is([role="alert"],.arco-form-item-message,.error-message,[class*="error-message-"],.form-error,.upload-error)';
const explicitAlert='[data-status="error"],[data-severity="error"],[class*="alert-error" i],[class*="banner-error" i]';
const classifiedNotices=[toast,inline,explicitAlert].join(',');
const visibleSelectors=[classifiedNotices,validation,'[role="alert"]'].join(',');

const publicLabels=[
  '作品名称','音乐类型','歌曲属性','词作者','曲作者','歌手','是否使用AI','选择签约模式',
  '独家授权','非独家授权','签约身份','签约信息','番茄音乐','番茄畅听','确认签约协议',
  '确认签署','确认同步','下一步','添加未授权歌曲','确认添加','确认上传','发布作品',
];
const publicErrors=[
  '请输入作品名称','请填写作品名称','请选择音乐类型','请选择歌曲属性','请选择词作者',
  '请选择曲作者','请选择歌手','请上传音频','请上传歌词','请上传封面','请上传版权证明',
  '请选择签约身份','上传失败','上传失败，请重试','文件格式不支持','没有匹配结果','无匹配结果',
  '请上传歌曲','请检查歌曲是否上传成功','请检查歌词是否上传成功','作品名称不能为空','名称不符合规范，请修改',
  '请选择或添加词作者','请选择或添加曲作者','请选择或添加歌手','请上传封面图','请检查封面图是否上传成功',
  '请检查表单填写是否完整或正确',
];
const signingCaptions=[
  '数据安全验证','文件签署','签署','确认签署','发送验证码','获取验证码','重新发送','下一步',
  '验证码错误','验证码无效','验证码已过期','签署失败','签约失败','网络错误，请重试','暂时无法打开',
  '未进入签约阶段，签约链接未生成。','未进入签约阶段，签约链接未生成',
];
const signingErrorCodes=[
  'FANQIE_SIGNING_TOAST_ERROR','FANQIE_SIGNING_VALIDATION_ERROR','FANQIE_SIGNING_ALERT_ERROR',
  'FANQIE_PAGE_SCRIPT_ERROR','FANQIE_VISIBLE_ERRORS_OVERFLOW',
] as const;
const signingOperationCodes=new Set([
  'FANQIE_CONTRACT_LINK_NOT_READY','FANQIE_CONTRACT_GENERATION_FAILED','FANQIE_CONTRACT_GENERATION_TIMEOUT',
  'FANQIE_CONTRACT_VERIFICATION_REQUIRED','FANQIE_CONTRACT_VERIFICATION_AMBIGUOUS',
  'FANQIE_CONTRACT_PREVIEW_LEFT','FANQIE_EXISTING_CONTRACT_UNAVAILABLE','FANQIE_EXISTING_CONTRACT_UNVERIFIED',
  'FANQIE_AUTHORIZATION_SCOPE_CHANGED','FANQIE_AUTHORIZATION_WORK_MISMATCH',
]);
const signingToasts='[class*="toast-error" i],[class*="message-error" i],[class*="notification-error" i],.ant-notification-notice:has(.ant-notification-notice-icon-error)';
const signingValidation='[aria-invalid="true"],.ant-form-item-explain-error,.arco-form-item-message-error,.ds-form-error';
const signingAlerts='[class*="alert-error" i],[class*="banner-error" i],[data-status="error"],[data-severity="error"]';

function lastSequence(file:string){
  if(!fs.existsSync(file))return 0;
  const fd=fs.openSync(file,'r');
  try{
    const size=fs.fstatSync(fd).size,length=Math.min(size,4096);
    const tail=Buffer.alloc(length);
    fs.readSync(fd,tail,0,length,size-length);
    for(const line of tail.toString('utf8').trimEnd().split('\n').reverse()){
      try{
        const {sequence}=JSON.parse(line) as {sequence?:number};
        if(typeof sequence==='number'&&Number.isSafeInteger(sequence)&&sequence>0)return sequence;
      }catch{}
    }
    return 0;
  }finally{fs.closeSync(fd);}
}

const slot=(index:unknown)=>typeof index==='number'&&Number.isSafeInteger(index)&&index>=0&&index<Number.MAX_SAFE_INTEGER?index+1:null;
const sameStep=(a:Step,b:Step)=>a.step===b.step&&a.songIndex===b.songIndex;
function safeDetails(details?:FanqieDirectoryTraceDetails){
  if(!details)return;
  const counts:FanqieDirectoryTraceDetails={};
  for(const key of countKeys){
    const value=details[key];
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)counts[key]=value;
  }
  if(typeof details.songTitle==='string'){
    const title=details.songTitle.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,80);
    if(title)counts.songTitle=title;
  }
  if(details.issueCounts&&typeof details.issueCounts==='object'){
    const issueCounts:Record<string,number>={};
    for(const [code,value] of Object.entries(details.issueCounts).slice(0,24)){
      if(/^[A-Z0-9_]{1,80}$/u.test(code)&&typeof value==='number'&&Number.isSafeInteger(value)&&value>0)
        issueCounts[code]=value;
    }
    if(Object.keys(issueCounts).length)counts.issueCounts=issueCounts;
  }
  if(Object.keys(counts).length)return counts;
}

function safeFailure(error:unknown) {
  if (!(error instanceof Error)) return {name:'UnknownError',message:'非 Error 异常'};
  const cause=error.cause instanceof Error?error.cause:undefined;
  const rawMessage=cause?`${error.message}；${cause.name}: ${cause.message}`:error.message;
  const browserCode=/\bnet::(ERR_[A-Z0-9_]+)\b/u.exec(rawMessage)?.[1];
  const httpStatus=/\bHTTP(?: response)?(?: status)?\s*(\d{3})\b/iu.exec(rawMessage)?.[1];
  const playwrightOperation=/^(page|frame|locator|frameLocator)\.(goto|waitForNavigation|waitForURL|waitForLoadState|waitForResponse|waitForRequest|waitForSelector|waitFor|click|dblclick|fill|type|press|check|uncheck|selectOption|setInputFiles|evaluate|screenshot)\b/u.exec(rawMessage)?.[0];
  const waitApi=/\bwaiting for (getByText|getByRole|getByLabel|getByPlaceholder|getByTestId|locator|frameLocator)\b/u.exec(rawMessage)?.[1];
  const timeoutBudgetMs=/\bTimeout\s+(\d{1,7})ms exceeded\b/u.exec(rawMessage)?.[1];
  const message=rawMessage
    .replace(/https?:\/\/[^\s"'<>]+/giu,'[URL]')
    .replace(/[A-Z]:\\[^\s"'<>]+/giu,'[本地路径]')
    .replace(/(?:\bartist_id=)[^&\s]+/giu,'artist_id=[已隐藏]')
    .replace(/(['"“”])[^'"“”\r\n]{2,120}\1/gu,'[文本已隐藏]')
    .replace(/\s+/gu,' ').trim().slice(0,320);
  return {name:error.name.slice(0,80),message:message||'异常没有提供说明',...(cause?{causeName:cause.name.slice(0,80)}:{}),...(browserCode?{browserCode}:{}),...(httpStatus?{httpStatus:Number(httpStatus)}:{}),...(playwrightOperation?{playwrightOperation}:{}),...(waitApi?{waitApi}:{}),...(timeoutBudgetMs?{timeoutBudgetMs:Number(timeoutBudgetMs)}:{})};
}

// Preserve layout and error styling while suppressing text and media, including
// validation notices that echo submitted values. The page itself stays intact.
const redactionStyle = `
  *, *::before, *::after, *::marker, *::placeholder {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    -webkit-text-stroke: 0 transparent !important;
    text-shadow: none !important;
    text-decoration-color: transparent !important;
    background-image: none !important;
    border-image-source: none !important;
    list-style-image: none !important;
    mask-image: none !important;
  }
  input, textarea, select, [contenteditable], iframe, frame, object, embed,
  canvas, video, audio, img, svg, math {
    visibility: hidden !important;
  }
`;

// Reproduce only exact, fixed labels after masking the site's own text. This
// keeps known errors readable even when other error notices echo private data.
async function screenshotStyle(page:Page){
  const captions=await page.locator('body').evaluate((body,{origin,publicLabels,publicErrors,visibleSelectors})=>{
    if(location.protocol!=='https:'||location.origin!==origin)return [];
    const selector='label,h1,h2,h3,h4,button,[role="heading"],[role="button"],'+visibleSelectors;
    const labels=[];
    for(const node of body.querySelectorAll<HTMLElement>(selector)){
      if(!node.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;
      const rendered=node.innerText?.trim()??'';
      const error=node.matches(visibleSelectors);
      const index=(error?publicErrors:publicLabels).indexOf(rendered);
      if(index<0)continue;
      const children=[];
      for(let child:Element=node;child!==body&&child.parentElement;child=child.parentElement)
        children.unshift(Array.from(child.parentElement.children).indexOf(child)+1);
      labels.push({children,index,error,unpositioned:getComputedStyle(node).position==='static',center:node.tagName==='BUTTON'});
      if(labels.length===80)break;
    }
    return labels;
  },{origin:fanqieOrigin,publicLabels,publicErrors,visibleSelectors},{timeout:1200});
  const rules=captions.slice(0,80).flatMap(({children,index,error,unpositioned,center})=>{
    const text=Number.isInteger(index)?(error?publicErrors:publicLabels)[index]:undefined;
    if(!text||!children.length||!children.every(child=>Number.isSafeInteger(child)&&child>0))return [];
    const element='body'+children.map(child=>` > :nth-child(${child})`).join('');
    const color=error?'#950e3a':'#343434';
    return [unpositioned?element+' { position: relative !important; }':'',`${element}::after {
      content: ${JSON.stringify(text)} !important;
      display: flex !important;
      align-items: center !important;
      ${center?'justify-content: center !important;':''}
      position: absolute !important;
      inset: 0 !important;
      color: ${color} !important;
      -webkit-text-fill-color: ${color} !important;
      pointer-events: none !important;
    }`];
  });
  return redactionStyle+'\n'+rules.join('\n');
}

function screenshotBlock(page?:Page,signing?:SigningScope){
  if(!page)return 'no-page';
  if(page.isClosed())return 'page-closed';
  if(signing){
    if(signing.state==='detached')return 'signing-page-unregistered';
    if(signing.state==='navigated'||page.url()!==signing.url)return 'signing-page-navigated';
    return;
  }
  try{
    const url=new URL(page.url());
    if(url.protocol==='https:'&&url.origin===fanqieOrigin&&!url.username&&!url.password)return undefined;
  }catch{}
  return 'non-fanqie-origin';
}

function operationError(error:unknown,signing?:SigningScope){
  if(error instanceof Error){
    const browserFailure=fanqieBrowserFailureCode(error);
    if(browserFailure!=='FANQIE_BROWSER_OPERATION_FAILED')return browserFailure;
    if(signing?signingOperationCodes.has(error.message):/^FANQIE_[A-Z0-9_]{1,80}$/u.test(error.message))return error.message;
  }
  return 'FANQIE_BROWSER_OPERATION_FAILED';
}

function readVisibleErrors(page:Page,key:string){
  return page.locator('body').evaluate((body,{key,origin,toast,inline,validation,explicitAlert,classifiedNotices,visibleSelectors,publicErrors})=>{
    if(location.protocol!=='https:'||location.origin!==origin)return [];
    const observers=window as unknown as Record<string,{drain:()=>VisibleError[];stop:()=>void}|undefined>;
    if(!observers[key]){
      const invalid=/^(?:请(?:输入|填写|上传|选择|勾选|补充|添加|检查)|未(?:输入|填写|上传|选择))|必填|失败|错误|出错|无效|异常|过期|无法|不可用|超时|格式(?:不正确|不支持)|超过.*限制|不符合.*要求|(?:无|没有)匹配结果|\b(?:failed|error|invalid|expired|timed out)\b/iu;
      let previous=new Map<Element,string>();
      const events:VisibleError[]=[];
      const scan=()=>{
        const current=new Map<Element,string>();
        for(const node of body.querySelectorAll<HTMLElement>(visibleSelectors)){
          if(!node.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;
          const text=node.innerText?.trim()??'';
          if(!text)continue;
          const code=node.matches(toast)?'FANQIE_ARCO_TOAST_ERROR':node.matches(inline)?'FANQIE_ARCO_INLINE_ERROR':
            node.matches(validation)?'FANQIE_FORM_VALIDATION_ERROR':'FANQIE_PAGE_ALERT_ERROR';
          if((code==='FANQIE_FORM_VALIDATION_ERROR'||code==='FANQIE_PAGE_ALERT_ERROR')&&!node.matches(explicitAlert)&&!invalid.test(text))continue;
          if((code==='FANQIE_FORM_VALIDATION_ERROR'||code==='FANQIE_PAGE_ALERT_ERROR')&&!node.matches(classifiedNotices)&&
            (node.querySelector(classifiedNotices)||node.parentElement?.closest(classifiedNotices)))continue;
          current.set(node,text);
          if(previous.get(node)===text)continue;
          const control=node.closest('.arco-form-item')?.querySelector('label[for]')?.getAttribute('for')??undefined;
          const {x,y,width,height}=node.getBoundingClientRect();
          const region={x:x+scrollX,y:y+scrollY,width,height,caption:publicErrors.indexOf(text)};
          if(events.length<100)events.push({code,control,region});
          if(events.length===100)events.push({code:'FANQIE_VISIBLE_ERRORS_OVERFLOW'});
        }
        previous=current;
      };
      const observer=new MutationObserver(scan);
      observer.observe(body,{subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:['class','style','hidden','aria-hidden','role','data-status','data-severity']});
      observers[key]={drain:()=>{scan();return events.splice(0);},stop:()=>observer.disconnect()};
    }
    return observers[key]?.drain()??[];
  },{key,origin:fanqieOrigin,toast,inline,validation,explicitAlert,classifiedNotices,visibleSelectors,publicErrors},{timeout:1200});
}

async function markPageError(bytes:Buffer,{x,y,width,height,caption}:PageErrorRegion){
  if(![x,y,width,height].every(Number.isFinite))return bytes;
  const image=sharp(bytes);
  const size=await image.metadata();
  const left=Math.max(0,Math.floor(x)),top=Math.max(0,Math.floor(y));
  const w=Math.min(size.width,Math.ceil(x+width))-left,h=Math.min(size.height,Math.ceil(y+height))-top;
  if(w<1||h<1)return bytes;
  // The captured error may have disappeared before the screenshot. Recreate its
  // bounds and a fixed caption, without saving any site-supplied message text.
  const label=Number.isInteger(caption)?publicErrors[caption]??'页面报错':'页面报错';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f9e6eb"/>`+
    `<text x="3" y="${Math.min(h,16)}" fill="#950e3a" font-family="sans-serif" font-size="14">${label}</text></svg>`;
  return image.composite([{input:Buffer.from(svg),left,top}]).png().toBuffer();
}

function inspectSigningPage(page:Page,url:string,action:'collect'|'capture'|'stop',key?:string){
  const expected=action==='stop'?new URL(url).origin:url;
  return page.locator('body').evaluate((body,{expected,action,key,captions,toasts,validation,alerts}):SigningDiagnostics|undefined=>{
    if(location.protocol!=='https:'||(action==='stop'?location.origin:location.href)!==expected)return;
    const observers=window as unknown as Record<string,{drain:()=>SigningError[];stop:()=>void}|undefined>;
    if(key&&action==='stop'){
      observers[key]?.stop();
      delete observers[key];
      return;
    }
    const seen=(node:HTMLElement)=>node.checkVisibility({opacityProperty:true,visibilityProperty:true})&&
      !node.closest('[aria-hidden="true"],[hidden]');
    const region=(node:HTMLElement,error:boolean,caption:number):SigningRegion=>{
      const {x,y,width,height}=node.getBoundingClientRect();
      return {x,y,width,height,error,caption};
    };
    const explicit=[toasts,validation,alerts].join(',');
    const selector=explicit+',[role="alert"]';
    const notices=(root:Element|null)=>{
      const errors=new Map<HTMLElement,SigningError>();
      for(const node of root?.querySelectorAll<HTMLElement>(selector)??[]){
        if(!seen(node))continue;
        const text=node.innerText?.trim()??'';
        if(!node.matches(explicit)&&
          (!/失败|错误|无效|过期|无法|未生成|频繁|不可用|failed|error|expired|invalid/iu.test(text)||
            node.querySelector(explicit)))continue;
        let code:SigningError['code']='FANQIE_SIGNING_ALERT_ERROR';
        if(node.matches(validation))code='FANQIE_SIGNING_VALIDATION_ERROR';
        else if(node.matches(toasts))code='FANQIE_SIGNING_TOAST_ERROR';
        errors.set(node,{code,region:region(node,true,captions.indexOf(text))});
        if(errors.size===100)break;
      }
      return errors;
    };
    const data:SigningDiagnostics={width:innerWidth,height:innerHeight,regions:[],events:[]};
    if(action==='capture'){
      for(const event of notices(body).values())if(event.region)data.regions.push(event.region);
      const labels=body.children.length
        ?body.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"],label,button,[role="button"],p,span')
        :[body as HTMLElement];
      // Only matching public captions and geometry leave the browser document.
      let count=0;
      for(const node of labels){
        if(++count>500||data.regions.length===120)break;
        if(!seen(node))continue;
        const caption=captions.indexOf(node.innerText?.trim()??'');
        if(caption!==-1)data.regions.push(region(node,false,caption));
      }
      return data;
    }
    if(!key)return;
    if(!observers[key]){
      let previous=new Map<HTMLElement,SigningError>();
      const events:SigningError[]=[];
      const add=(event:SigningError)=>{
        if(location.href!==expected)return;
        if(events.length<100)events.push(event);
        if(events.length===100)events.push({code:'FANQIE_VISIBLE_ERRORS_OVERFLOW'});
      };
      const scan=(changed?:Set<Element>)=>{
        if(location.href!==expected){
          observers[key]?.stop();
          delete observers[key];
          return;
        }
        const current=notices(document.body);
        for(const [node,event] of current){
          const old=previous.get(node);
          if(changed?.has(node)||old?.code!==event.code||old.region?.caption!==event.region?.caption)add(event);
        }
        previous=current;
      };
      // Frame events do not bubble to their embedding document.
      const scriptError=()=>add({code:'FANQIE_PAGE_SCRIPT_ERROR'});
      const observer=new MutationObserver(records=>{
        const changed=new Set<Element>();
        for(const record of records){
          if(record.type==='attributes')continue;
          const target=record.target instanceof Element?record.target:record.target.parentElement;
          const notice=target?.closest(selector);
          if(notice)changed.add(notice);
        }
        scan(changed);
      });
      observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:['class','style','hidden','aria-hidden','role','aria-invalid','data-status','data-severity']});
      window.addEventListener('error',scriptError);
      observers[key]={
        drain:()=>{scan();return events.splice(0);},
        stop:()=>{observer.disconnect();window.removeEventListener('error',scriptError);},
      };
    }
    data.events=observers[key]?.drain()??[];
    return data;
  },{expected,action,key,captions:signingCaptions,toasts:signingToasts,validation:signingValidation,alerts:signingAlerts},{timeout:1200});
}

async function signingScreenshot(page:Page,url:string,observed?:SigningRegion){
  const layout=await inspectSigningPage(page,url,'capture').catch(()=>undefined);
  if(!layout||!Number.isSafeInteger(layout.width)||!Number.isSafeInteger(layout.height)||layout.width<1||layout.height<1)return;
  const width=Math.min(layout.width,1920),height=Math.min(layout.height,1200);
  // Draw only measured bounds and fixed captions. No rendered site pixels,
  // embedded document, QR code, input value or unrecognized caption is copied.
  const regions=(observed?[...layout.regions,observed]:layout.regions).slice(0,121).map(region=>{
    if(![region.x,region.y,region.width,region.height].every(Number.isFinite))return '';
    const x=Math.max(0,Math.round(region.x)),y=Math.max(0,Math.round(region.y));
    const w=Math.min(width,Math.round(region.x+region.width))-x,h=Math.min(height,Math.round(region.y+region.height))-y;
    if(w<1||h<1)return '';
    const caption=Number.isInteger(region.caption)?signingCaptions[region.caption]:undefined;
    const fill=region.error?'#f9e6eb':'#e4e8ed',ink=region.error?'#950e3a':'#343434';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`+
      (caption?`<text x="${x+3}" y="${y+Math.min(h,16)}" fill="${ink}" font-family="sans-serif" font-size="14">${caption}</text>`:'');
  }).join('');
  if(!regions)return;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f5f6f8"/>${regions}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Append one ordered, redacted diagnostic stream for a directory run. */
export class FanqieDirectoryTrace {
  private readonly folder:string;
  private readonly file:string;

  constructor(folder:string,private readonly mark:(label:string,error?:string)=>void){
    this.folder=path.resolve(folder);
    fs.mkdirSync(this.folder,{recursive:true});
    this.file=path.join(this.folder,'trace.jsonl');
  }

  private async capture(page:Page|undefined,sequence:number,observedUrl:string|undefined,{signing,alert}:ScreenshotEvidence={}){
    const blocked=screenshotBlock(page,signing?.scope);
    if(!page||blocked)return {screenshotReason:blocked};
    let navigated=false;
    const before=page.url();
    if(before!==observedUrl)return {screenshotReason:'page-navigated'};
    const detectNavigation=(frame:Frame)=>{if(frame===page.mainFrame())navigated=true;};
    page.on('framenavigated',detectNavigation);
    try{
      let bytes:Buffer|undefined;
      if(signing){
        bytes=await signingScreenshot(page,signing.scope.url,signing.region);
      }else{
        const style=await screenshotStyle(page).catch(()=>redactionStyle);
        const blockedBeforeCapture=screenshotBlock(page);
        if(blockedBeforeCapture)return {screenshotReason:blockedBeforeCapture};
        if(navigated||before!==page.url())return {screenshotReason:'page-navigated'};
        const screenshot=await page.screenshot({type:'png',fullPage:true,scale:'css',caret:'hide',style,timeout:2500});
        bytes=alert?await markPageError(screenshot,alert).catch(()=>screenshot):screenshot;
      }
      // Hold the bytes in memory until the document and origin are checked again.
      const after=screenshotBlock(page,signing?.scope);
      if(after)return {screenshotReason:after};
      if(navigated||before!==page.url())return {screenshotReason:'page-navigated'};
      if(!bytes)return {screenshotReason:'signing-layout-unavailable'};
      const screenshot='screenshots/event-'+sequence+'-'+randomUUID()+'.png';
      const file=path.join(this.folder,screenshot);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,bytes,{flush:true});
      return signing?{screenshot,screenshotMode:'redacted-signing-layout'}:{screenshot};
    }catch{
      return {screenshotReason:screenshotBlock(page,signing?.scope)??'capture-unreadable'};
    }finally{page.off('framenavigated',detectNavigation);}
  }

  private append(round:number,entry:TraceEntry,page?:Page,evidence?:ScreenshotEvidence){
    const at=new Date().toISOString();
    const observedUrl=entry.event==='error'?page?.url():undefined;
    const key=traceKey(this.file);
    const write=(activeWrites.get(key)??Promise.resolve()).then(async()=>{
      const sequence=lastSequence(this.file)+1;
      const image=entry.event==='error'?await this.capture(page,sequence,observedUrl,evidence):undefined;
      fs.appendFileSync(this.file,JSON.stringify({at,sequence,round,...entry,...(evidence?.signing?{page:'signing'}:{}),...image})+'\n',
        {encoding:'utf8',flush:true});
    });
    const settled=write.catch(()=>{
      try{this.mark('记录番茄操作日志失败','FANQIE_TRACE_WRITE_FAILED');}catch{}
    });
    activeWrites.set(key,settled);
    void settled.then(()=>{if(activeWrites.get(key)===settled)activeWrites.delete(key);});
    return write.catch(()=>{throw Error('FANQIE_TRACE_WRITE_FAILED');});
  }

  round(number:number):FanqieDirectoryTracePort {
    const steps=new WeakMap<Page,PageSteps>();
    const currentStep=(steps?:PageSteps)=>steps?.open.at(-1)??steps?.recent;
    const watchers=new WeakMap<Page,PageWatcher>();
    const signingWatchers=new WeakMap<Page,PageWatcher>();
    const signingScopes=new WeakMap<Page,SigningScope>();
    const backgroundError=(page:Page,code:string,control?:string,evidence?:ScreenshotEvidence)=>{
      const at=currentStep(steps.get(page))??{step:evidence?.signing?'contract:verification-window':'page',songIndex:null};
      const match=typeof control==='string'?songField.exec(control):null;
      void this.append(number,{...at,event:'error',code,
        songIndex:(match?slot(Number(match[1])):null)??at.songIndex,field:match?.[2]},page,evidence).catch(()=>{});
    };
    const startWatching=(page:Page,registry:WeakMap<Page,PageWatcher>,signing?:SigningScope)=>{
      const key='__rainfallFanqieTrace_'+randomUUID();
      let active=true;
      let timer:ReturnType<typeof setTimeout>|undefined;
      let sampling:Promise<void>|undefined;
      const inScope=()=>!screenshotBlock(page,signing)&&(signing!==undefined||signingScopes.get(page)?.state!=='active');
      const scriptError=()=>{if(inScope())backgroundError(page,'FANQIE_PAGE_SCRIPT_ERROR');};
      const flush=()=>{
        if(!active||!inScope())return Promise.resolve();
        if(sampling)return sampling;
        clearTimeout(timer);
        const sample=signing?inspectSigningPage(page,signing.url,'collect',key).then(data=>{
          if(active&&inScope())for(const event of data?.events??[]){
            if(signingErrorCodes.includes(event.code))backgroundError(page,event.code,undefined,{signing:{scope:signing,region:event.region}});
          }
        }):readVisibleErrors(page,key).then(events=>{
          if(active&&inScope())for(const event of events)if(visibleErrorCodes.includes(event.code))
            backgroundError(page,event.code,event.control,{alert:event.region});
        });
        sampling=sample.catch(()=>{}).finally(()=>{
          sampling=undefined;
          if(active)timer=setTimeout(poll,200).unref();
        });
        return sampling;
      };
      const poll=()=>{void flush();};
      const stop=()=>{
        if(!active)return;
        active=false;
        clearTimeout(timer);
        registry.delete(page);
        if(signing?.state==='active')signing.state='detached';
        page.off('pageerror',scriptError);
        page.off('framenavigated',invalidate);
        page.off('domcontentloaded',poll);
        page.off('close',stop);
        void Promise.resolve(sampling).catch(()=>{}).then(async()=>{
          if(signing){
            const current=page.url();
            if(!page.isClosed()&&URL.canParse(current)&&new URL(current).origin===new URL(signing.url).origin)
              await inspectSigningPage(page,signing.url,'stop',key);
            return;
          }
          if(screenshotBlock(page))return;
          await page.locator('body').evaluate((_,{key,origin})=>{
            if(location.protocol!=='https:'||location.origin!==origin)return;
            const observers=window as unknown as Record<string,{stop:()=>void}|undefined>;
            observers[key]?.stop();
            delete observers[key];
          },{key,origin:fanqieOrigin},{timeout:1200});
        }).catch(()=>{});
      };
      const invalidate=(frame:Frame)=>{
        if(signing&&frame===page.mainFrame()){
          signing.state='navigated';
          stop();
        }
      };
      if(signing)page.on('framenavigated',invalidate);
      else page.on('pageerror',scriptError);
      page.on('domcontentloaded',poll);
      page.on('close',stop);
      poll();
      return {references:0,flush,stop};
    };
    const acquire=(page:Page,registry:WeakMap<Page,PageWatcher>,signing?:SigningScope)=>{
      if(page.isClosed())return ()=>{};
      const watcher=registry.get(page)??startWatching(page,registry,signing);
      registry.set(page,watcher);
      watcher.references++;
      let released=false;
      return ()=>{if(!released){released=true;if(--watcher.references===0)watcher.stop();}};
    };
    return {
      trace:async(step,phase,page,songIndex,error,details)=>{
        const location={step:/^[a-z][a-z0-9:_-]{0,79}$/u.test(step)?step:'operation',songIndex:slot(songIndex)};
        const signing=page&&signingScopes.get(page);
        if(page){
          const watcher=(signing?signingWatchers:watchers).get(page),group=steps.get(page);
          const previous=currentStep(group);
          if(phase==='begin'){
            if(previous&&!sameStep(previous,location))await watcher?.flush();
            const open=group?.open??[];
            open.push(location);
            steps.set(page,{open,recent:location});
          }else{
            if(!previous)steps.set(page,{open:[],recent:location});
            await watcher?.flush();
            const index=group?.open.findLastIndex(step=>sameStep(step,location))??-1;
            if(group&&index>=0){
              group.open.splice(index);
              group.recent=location;
            }
          }
        }
        return this.append(number,{...location,event:phase,code:phase==='error'?operationError(error,signing):undefined,
          failure:phase==='error'?safeFailure(error):undefined,details:safeDetails(details)},
          page,signing?{signing:{scope:signing}}:undefined);
      },
      watch:page=>acquire(page,watchers),
      watchSigningPage:(page,verifiedUrl)=>{
        if(page.isClosed()||page.url()!==verifiedUrl||!URL.canParse(verifiedUrl))return ()=>{};
        const url=new URL(verifiedUrl);
        if(url.protocol!=='https:'||url.username||url.password)return ()=>{};
        const previous=signingScopes.get(page);
        if(previous?.state==='active'&&previous.url===url.href)return acquire(page,signingWatchers,previous);
        signingWatchers.get(page)?.stop();
        const signing:SigningScope={url:url.href,state:'active'};
        signingScopes.set(page,signing);
        return acquire(page,signingWatchers,signing);
      },
    };
  }
}
