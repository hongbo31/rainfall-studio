import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';
const endpoint=process.argv[2]??'http://127.0.0.1:9222';
const address=new URL(endpoint);
if(address.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(address.hostname)||address.username||address.password||address.pathname!=='/'||address.search||address.hash)throw Error('LOOPBACK_CDP_REQUIRED');
const folder=path.resolve('output/album-pagination');fs.mkdirSync(folder,{recursive:true});
const out=path.join(folder,'official-readonly-proof.cjs');await build({entryPoints:['src/main/tme/official-browser-read.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external'});
const {readOfficialAlbumDirectory,readOfficialPendingSongs}=createRequire(import.meta.url)(out);
const browser=await chromium.connectOverCDP(endpoint);
const report={at:new Date().toISOString(),source:'official',onlineVerified:false,operation:'readonly-album-directory-and-pending-references',backgroundTargetsOnly:true,primaryPreserved:false,realPlatformWrites:0};
let primary,primaryUrl,initialPages;
const safeError=(error)=>{const message=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_]{0,79}$/.test(message)?message:'READONLY_PROOF_FAILED';};
const enumValue=(value,allowed)=>value===null?null:allowed.includes(value)?value:'UNVERIFIED';
const integerValue=(value)=>value===null?null:/^[0-9]{1,8}$/.test(value)?value:'UNVERIFIED';
try{
 const pages=browser.contexts().flatMap(c=>c.pages());primary=pages.find(p=>{try{return new URL(p.url()).origin==='https://y.tencentmusic.com';}catch{return false;}});
 if(!primary)throw Error('EXISTING_OFFICIAL_PRIMARY_REQUIRED');primaryUrl=primary.url();initialPages=primary.context().pages();
 report.observations=[];
 primary.context().on('page',p=>p.on('response',r=>{try{const u=new URL(r.url());if(u.origin!=='https://y.tencentmusic.com'||!['/cd-gateway/musician/original/pagePublishAlbum','/cd-gateway/musician/original/pageUnPublishAlbum','/openapi/musician/original/cursorUnPublishSong'].includes(u.pathname))return;const split=new URL(p.url()).hash.split('?'),query=new URLSearchParams(split[1]);report.observations.push({path:u.pathname,route:enumValue(split[0],['#/user/manage/albumlist','#/user/musician/edit']),tab:enumValue(query.get('tab'),['published','unPublish']),type:enumValue(query.get('type'),['Album','Song']),nameFilterEmpty:u.searchParams.get('name')==='',showStatus:enumValue(u.searchParams.get('showStatus'),['0']),pageNo:integerValue(u.searchParams.get('pageNo')),pageSize:integerValue(u.searchParams.get('pageSize'))});}catch{}}));
 const directory=await readOfficialAlbumDirectory(primary),pending=await readOfficialPendingSongs(primary);
 const after=primary.context().pages();report.primaryPreserved=primary.url()===primaryUrl&&initialPages.length===after.length&&initialPages.every(p=>after.includes(p));
 if(!report.primaryPreserved)throw Error('PRIMARY_OR_TAB_SET_CHANGED');
 report.directory={coverage:directory.coverage,sources:directory.sourceCoverage.map(s=>({...s,path:s.publication==='published'?'/cd-gateway/musician/original/pagePublishAlbum':'/cd-gateway/musician/original/pageUnPublishAlbum'}))};
 report.pending={coverage:pending.coverage,path:'/openapi/musician/original/cursorUnPublishSong'};
 report.onlineVerified=true;report.completedAt=new Date().toISOString();
 fs.writeFileSync(path.join(folder,'official-readonly-proof.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){report.error=safeError(error);report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(folder,'official-readonly-proof.json'),JSON.stringify(report,null,2));throw Error(report.error);}
finally{
 if(primary&&initialPages){const after=primary.context().pages();report.primaryPreserved=primary.url()===primaryUrl&&initialPages.length===after.length&&initialPages.every(p=>after.includes(p));}
 fs.writeFileSync(path.join(folder,'official-readonly-proof.json'),JSON.stringify(report,null,2));await browser.close();
}
