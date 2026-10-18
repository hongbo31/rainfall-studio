// Injected Playwright-shaped document. No network, Chromium, production account or remote write.
export function submissionBrowserFixture(){
 const nodes=new Map(), state={clicks:0,rows:[],record:{kind:'song',id:'song-12345',title:'fixture song',artist:'fixture artist',status:'reviewing',date:'2026-10-18T10:00:00Z'},clickFailure:false};
 for(const [id,value]of Object.entries({kugou:'123456789',qq:'fixture account',artist:'fixture artist',title:'fixture song',mode:'AI authorization',terms:'fixture terms',accept:'',submit:''}))nodes.set('#'+id,[{value,checked:false}]);
 function locator(selector,root){
  const list=()=>root?[{value:root[selector.slice(1)]}]:selector==='#rows .receipt'?state.rows:(nodes.get(selector)??[]);
  return{count:async()=>list().length,isVisible:async()=>list().length>0,isEnabled:async()=>true,innerText:async()=>list()[0].value,isChecked:async()=>list()[0].checked,locator:s=>locator(s,list()[0]),click:async()=>{if(selector==='#accept')list()[0].checked=true;if(selector==='#submit'){state.clicks++;state.rows=[{...state.record}]}if(state.clickFailure)throw Error('CLICK_TIMEOUT')},first:()=>locator(selector,root)};
 }
 const page={url:()=>state.url??'https://y.tencentmusic.com/fixture-only',locator};
 return{page,state,set:(id,value)=>nodes.get('#'+id)[0].value=value,duplicate:id=>nodes.get('#'+id).push({...nodes.get('#'+id)[0]})};
}
