import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {chromium,type Browser,type Page,type ConnectOverCDPTransport} from 'playwright-core';
import {z} from 'zod';
import {TmeAiPrepareBindingSchema,tmeAiSubjectHash} from '../../shared/tme-ai-prepare';
import {TME_AI_BROWSER_PREPARE_CONTRACT,createTmeAiBrowserPreparePort,type TmeAiBrowserPrepareContract} from './ai-prepare-browser';
import {TME_AI_BROWSER_SUBMISSION_CONTRACT,createTmeAiBrowserSubmissionExecutor,type TmeAiBrowserSubmissionContract} from './ai-submission-browser';
import {readOfficialProfileIdentity,TME_READONLY_IDENTITY_EVIDENCE_HASH} from './browser-identity';
import {readFreshOfficialAccount} from './official-browser-read';
import {createExternalTmeReceiptReader} from './external-receipt-read';
const ORIGIN='https://y.tencentmusic.com';
const ConnectSchema=z.strictObject({port:z.number().int().min(1024).max(65535).default(9222),allowConnection:z.literal(true)});
/** Refuse discovery redirects or remote websocket endpoints. Never start or configure a browser. */
export function validateCloudCdpEndpoint(endpoint:string,port:number){
 const u=new URL(endpoint);
 if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||Number(u.port)!==port||u.username||u.password||u.hash||u.search||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(u.pathname))throw Error('LOOPBACK_CDP_REQUIRED');
 return u.href;
}
async function connectExisting(port:number):Promise<Browser>{
 const endpoint=await new Promise<string>((resolve,reject)=>{
  const request=http.get({hostname:'127.0.0.1',port,path:'/json/version',timeout:5000},response=>{
   if(response.statusCode!==200){response.resume();reject(Error('CDP_DISCOVERY_REJECTED'));return}
   let data='';response.setEncoding('utf8');response.on('data',chunk=>{data+=chunk;if(data.length>65536){response.destroy();reject(Error('CDP_DISCOVERY_REJECTED'))}});
   response.on('error',reject);response.on('end',()=>{try{resolve(validateCloudCdpEndpoint(JSON.parse(data).webSocketDebuggerUrl,port))}catch{reject(Error('LOOPBACK_CDP_REQUIRED'))}});
  });
  request.on('timeout',()=>request.destroy(Error('CDP_CONNECTION_TIMEOUT')));request.on('error',reject);
 });
 // WHATWG WebSocket refuses redirects; Playwright's URL connector follows them.
 const socket=new WebSocket(endpoint);
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.close();reject(Error('CDP_CONNECTION_TIMEOUT'))},10000);
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP_CONNECTION_FAILED'))},{once:true});
 });
 const transport:ConnectOverCDPTransport={send:message=>socket.send(JSON.stringify(message)),close:()=>socket.close()};
 socket.addEventListener('message',event=>{try{transport.onmessage?.(JSON.parse(String(event.data)))}catch{socket.close()}});
 socket.addEventListener('close',()=>transport.onclose?.());
 try{return await chromium.connectOverCDP(transport,{timeout:10000,noDefaults:true})}catch(e){socket.close();throw e}
}
type Options={enableExistingAlbum?:boolean;connectCDP?:(port:number)=>Promise<Browser>;now?:()=>Date;available?:()=>boolean;prepareContract?:TmeAiBrowserPrepareContract;submissionContract?:TmeAiBrowserSubmissionContract};
type PreparationSession=Parameters<typeof createTmeAiBrowserPreparePort>[0];
type SubmissionSession=Parameters<typeof createTmeAiBrowserSubmissionExecutor>[0];
/** Main-only owner of an explicitly connected existing CDP session; no cookies or renderer contracts. */
export class TmeAiCloudSessionManager{
 private readonly prepareContract:TmeAiBrowserPrepareContract;
 private readonly submissionContract:TmeAiBrowserSubmissionContract;
 private browser?:Browser;private page?:Page;private bindingValue?:ReturnType<typeof TmeAiPrepareBindingSchema.parse>;
 private preparation?:PreparationSession;private submission?:SubmissionSession;private existingSession?:{page:Page;account:()=>Promise<any>;now?:()=>Date};private fingerprint?:string;
 private epoch=0;private connecting=false;
 constructor(private readonly options:Options={}){
  this.prepareContract=structuredClone(options.prepareContract??TME_AI_BROWSER_PREPARE_CONTRACT);
  this.submissionContract=structuredClone(options.submissionContract??TME_AI_BROWSER_SUBMISSION_CONTRACT);
 }
 private available(){if(this.options.available&&!this.options.available())throw Error('PRODUCTION_REQUIRED')}
 private assertCurrent(page:Page,epoch:number){
  this.available();if(epoch!==this.epoch||this.page!==page||!this.browser?.isConnected()||page.isClosed())throw Error('CLOUD_BROWSER_SESSION_REQUIRED');
  const u=new URL(page.url());if(u.origin!==ORIGIN||u.username||u.password)throw Error('PAGE_ORIGIN_CHANGED');
 }
 private identityCalibrated(){if(this.options.enableExistingAlbum)return true;const c=this.submissionContract;return c.verified&&c.source==='browser'&&c.origin===ORIGIN&&/^[a-f0-9]{64}$/.test(c.calibrationEvidenceHash)&&Object.values(c.identity).length===3&&['kugouId','qqDisplayName','artistName'].every(k=>!!c.identity[k as keyof typeof c.identity]?.trim())}
 private async account(page:Page,epoch:number){
  this.assertCurrent(page,epoch);
  if(this.options.enableExistingAlbum){const identity=await readFreshOfficialAccount(page,{expectedSubjectHash:this.fingerprint});this.assertCurrent(page,epoch);const fingerprint=tmeAiSubjectHash(identity);if(this.fingerprint&&this.fingerprint!==fingerprint)throw Error('ACCOUNT_CHANGED');this.fingerprint=fingerprint;return{identity,binding:this.bindingValue!}}
  if(!this.identityCalibrated())throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
  const identity={kugouId:'',qqDisplayName:'',artistName:''};
  for(const key of Object.keys(identity) as (keyof typeof identity)[]){
   const locator=page.locator(this.submissionContract.identity[key]);
   if(await locator.count()!==1||!await locator.isVisible())throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
   identity[key]=(await locator.innerText({timeout:5000})).trim();if(!identity[key])throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
  }
  this.assertCurrent(page,epoch);const fingerprint=tmeAiSubjectHash(identity);
  if(this.fingerprint&&this.fingerprint!==fingerprint)throw Error('ACCOUNT_CHANGED');this.fingerprint=fingerprint;
  return{identity,binding:this.bindingValue!};
 }
 async connect(input:unknown){
  this.available();const {port}=ConnectSchema.parse(input);
  if(this.connecting)throw Error('BROWSER_CONNECTION_BUSY');if(this.browser?.isConnected())throw Error('BROWSER_ALREADY_CONNECTED');
  this.connecting=true;const epoch=++this.epoch;let browser:Browser|undefined;
  try{
   browser=await(this.options.connectCDP??connectExisting)(port);this.available();if(epoch!==this.epoch)throw Error('BROWSER_CONNECTION_CANCELLED');
   const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{const u=new URL(p.url());return!p.isClosed()&&u.origin===ORIGIN&&!u.username&&!u.password}catch{return false}});
   if(pages.length!==1)throw Error('SINGLE_TME_PAGE_REQUIRED');const page=pages[0];
   this.bindingValue=TmeAiPrepareBindingSchema.parse({transport:'cloud-playwright',sessionId:randomUUID(),pageId:randomUUID(),started:(this.options.now?.()??new Date()).toISOString()});
   this.browser=browser;this.page=page;this.fingerprint=undefined;
   this.preparation={page,contract:this.prepareContract,account:()=>this.account(page,epoch),now:this.options.now};
   this.submission={page,contract:this.submissionContract,binding:()=>{this.assertCurrent(page,epoch);return this.bindingValue!},now:this.options.now};
   if(this.options.enableExistingAlbum)this.existingSession={page,account:()=>this.account(page,epoch),now:this.options.now};
   browser.on('disconnected',()=>{if(this.browser===browser)this.clear()});
   this.connecting=false;return this.status();
  }catch(e){if(browser)await browser.close().catch(()=>{});throw e}finally{this.connecting=false}
 }
 private clear(){this.epoch++;this.browser=undefined;this.page=undefined;this.bindingValue=undefined;this.preparation=undefined;this.submission=undefined;this.existingSession=undefined;this.fingerprint=undefined}
 async inspectAccount(input:unknown={}){
  z.strictObject({}).parse(input);this.available();const page=this.page,epoch=this.epoch;
  if(!page)throw Error('CLOUD_BROWSER_SESSION_REQUIRED');this.assertCurrent(page,epoch);
  const identity=this.options.enableExistingAlbum?await readFreshOfficialAccount(page,{expectedSubjectHash:this.fingerprint}):await readOfficialProfileIdentity(page);this.assertCurrent(page,epoch);
  const subjectHash=tmeAiSubjectHash(identity);if(this.fingerprint&&this.fingerprint!==subjectHash)throw Error('ACCOUNT_CHANGED');
  this.fingerprint=subjectHash;
  return{artistName:identity.artistName,qqDisplayName:identity.qqDisplayName,maskedKugouId:'***'+identity.kugouId.slice(-4),subjectType:'official_visible_binding_fingerprint' as const,subjectHash,observedAt:(this.options.now?.()??new Date()).toISOString(),evidenceHash:TME_READONLY_IDENTITY_EVIDENCE_HASH,binding:this.bindingValue,readOnly:true as const};
 }
 /** Closing a connectOverCDP client disconnects it; it does not close the user's tabs/browser. */
 async disconnect(){const browser=this.browser;this.clear();if(browser)await browser.close();return this.status()}
 status(){
  const connected=!!this.browser?.isConnected()&&!!this.page&&!this.page.isClosed();
  return{connected,connecting:this.connecting,transport:'cloud-playwright' as const,binding:connected?this.bindingValue:undefined,identityCalibrated:this.identityCalibrated(),readOnlyReceiptAvailable:connected&&this.options.enableExistingAlbum===true,existingAlbumWritesEnabled:false,reasons:[...(this.options.enableExistingAlbum?['EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED']:[]),...(!connected?['CLOUD_BROWSER_SESSION_REQUIRED']:[]),...(!this.identityCalibrated()?['BROWSER_ACCOUNT_IDENTITY_UNVERIFIED']:[]),...(!this.prepareContract.verified?['BROWSER_AI_PREPARE_CONTRACT_UNVERIFIED']:[]),...(!this.submissionContract.verified?['BROWSER_AI_SUBMIT_CONTRACT_UNVERIFIED','OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED']:[])]};
 }
 preparationSession(){return this.preparation}
 async fillIntakeFields(_input:unknown){
  // One-time calibration is not an alternate runtime write entry.
  throw Error('EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED');
 }
 existingAlbumSession(){return this.existingSession}
 async readExternalReceipt(context:unknown){
  this.available();const page=this.page,epoch=this.epoch;if(!page||!this.options.enableExistingAlbum)throw Error('CLOUD_BROWSER_SESSION_REQUIRED');this.assertCurrent(page,epoch);
  const result=await createExternalTmeReceiptReader({page})(context);this.assertCurrent(page,epoch);return result;
 }
 submissionSession(){return this.submission}
}
