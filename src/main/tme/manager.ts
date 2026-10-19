import {randomUUID} from 'node:crypto';import os from 'node:os';
import {chromium,type Browser} from 'playwright-core';
import {z} from 'zod';
import {TmeCoordinator,type DraftStore,type DraftAuthorization} from './coordinator';
import {PlaywrightTmePort} from './browser-port';
export const BrowserInspectSchema=z.strictObject({port:z.number().int().min(1024).max(65535).optional(),allowConnection:z.boolean().optional()});
export const BrowserRunSchema=z.strictObject({id:z.uuid(),authorizationNonce:z.uuid(),reviewHash:z.string().length(64),confirmed:z.literal(true)});
export class TmeBrowserManager{
 private browser?:Browser;private runner?:TmeCoordinator;private port?:number;
 private authorization?:DraftAuthorization&{nonce:string;expires:number};
 constructor(private store:DraftStore){}
 async inspect(raw:unknown){
  const v=BrowserInspectSchema.parse(raw);this.authorization=undefined;
  if(!v.port)return{connected:false,identity:null,reason:'BROWSER_CONNECTION_REQUIRED',contractVerified:false};
  if(!v.allowConnection)throw Error('BROWSER_CONNECTION_NOT_AUTHORIZED');
  if(this.port&&this.port!==v.port)throw Error('BROWSER_SESSION_CHANGE_REQUIRES_REVIEW');
  // Attaches only to an already-enabled local connection. Never launch/restart a user browser.
  if(!this.browser){this.browser=await chromium.connectOverCDP('http://127.0.0.1:'+v.port,{timeout:5000,noDefaults:true});this.port=v.port;}
  const pages=this.browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{return new URL(p.url()).origin==='https://y.tencentmusic.com'}catch{return false}});
  if(pages.length!==1)return{connected:false,identity:null,reason:pages.length?'MULTIPLE_TME_TABS':'TME_PAGE_REQUIRED',contractVerified:false};
  const adapter=new PlaywrightTmePort(pages[0],os.hostname(),randomUUID());
  const observed=await adapter.observe();this.runner=new TmeCoordinator(this.store,adapter);
  if(observed.identity&&observed.contractVerified&&!observed.blockedReason)this.authorization={identity:observed.identity,reviewHash:'',confirmed:false,nonce:randomUUID(),expires:Date.now()+5*60000};
  return{connected:true,...observed,reason:observed.blockedReason,authorizationNonce:this.authorization?.nonce||null};
 }
 async run(raw:unknown){const v=BrowserRunSchema.parse(raw),a=this.authorization;this.authorization=undefined;if(!a||!this.runner||a.nonce!==v.authorizationNonce||a.expires<Date.now())throw Error('BROWSER_AUTHORIZATION_REQUIRED');return this.runner.run(v.id,{identity:a.identity,reviewHash:v.reviewHash,confirmed:v.confirmed});}
 // There is deliberately no submit-review operation in the public bridge.
}
