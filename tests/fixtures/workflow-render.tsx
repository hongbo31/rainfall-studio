import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Context} from '../../src/renderer/context';
import ChatCreation from '../../src/renderer/pages/ChatCreation';
export function renderWorkflow(mode:'simulation'|'production'){
 const value:any={data:{mode,artists:[{id:'test-artist',name:'测试'}],series:[]},call:()=>{throw Error('SSR_MUST_NOT_CALL_CORE');},notify:()=>{},play:()=>{}};
 return renderToStaticMarkup(<Context.Provider value={value}><ChatCreation/></Context.Provider>);
}
