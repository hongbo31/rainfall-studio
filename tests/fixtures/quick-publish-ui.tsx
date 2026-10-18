import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Context} from '../../src/renderer/context';
import PublicationDiagnostics from '../../src/renderer/pages/PublicationDiagnostics';
import ManualReport from '../../src/renderer/components/ManualReport';
export function renderPublish(mode='production',pair=true) {
 const work={id:'fixture-work',title:'本地原创曲',artistId:'fixture-artist',assets:{audio_A:'a',...(pair?{audio_B:'b'}:{}),cover:'c'},lyrics:'窗前示例作品A',config:{genre:'流行',language:'中文'},rights:'商业授权待确认'};
 const data={mode,works:[work],artists:[{id:'fixture-artist',name:'测试艺人'}],accounts:[],bindings:[],batches:[],units:[],targets:[],exceptions:[]};
 const actions:any[]=[];
 const html=renderToStaticMarkup(<Context.Provider value={{data,selected:[work.id],setSelected:()=>{},call:async(...args:any[])=>{actions.push(args);},go:()=>{},notify:()=>{}} as any}><PublicationDiagnostics/></Context.Provider>);
 return {html,actions};
}
export function renderManual() {
 return renderToStaticMarkup(<Context.Provider value={{call:async()=>{}} as any}><ManualReport unit={{id:'fixture-unit'}} onClose={()=>{}}/></Context.Provider>);
}
export function receiptScope(unit:any) {
 let key:React.Key|null=null;
 function Probe(){const element=ManualReport({unit,onClose:()=>{}});key=element.key;return element;}
 const html=renderToStaticMarkup(<Context.Provider value={{call:async()=>{},data:{accounts:[{id:'account-b',name:'账号乙'}]}} as any}><Probe/></Context.Provider>);
 return {key,html};
}
