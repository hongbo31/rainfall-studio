const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const React=require('react');

// Regression target: an unscoped boolean consent survives a polled materials update.
// Compile actual production TSX; substitute only hook scheduling and the app context.
// Rendering preserves hook state across new props, and invokes real UI event handlers.
// Deliberately run no effects: a changed identity must be invalid on that very render.
function fixture(){
  const state=[],calls=[],pending=[];
  let cursor=0,tree;
  const hookReact={...React,useState(initial){
    const index=cursor++;
    if(!(index in state))state[index]=typeof initial==='function'?initial():initial;
    return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];
  }};
  const moduleFixture={exports:{}};
  const context={call:async(method,input)=>{calls.push({method,input});},go:()=>{}};
  const source=fs.readFileSync(process.env.RAINFALL_PLAN_RUN_ASSETS_UI_BUNDLE,'utf8');
  vm.runInNewContext(source,{
    module:moduleFixture,exports:moduleFixture.exports,
    require(name){
      if(name==='react')return hookReact;
      if(name==='../context')return{useStudio:()=>context};
      throw Error('UNEXPECTED_COMPONENT_DEPENDENCY '+name);
    },
  },{filename:'PlanRunAssets.cjs'});
  const Component=moduleFixture.exports.default;
  const props={
    item:{id:'fixture-item-1',ordinal:1,workId:'fixture-work-1',selectedVersion:'A',
      versions:[{version:'A',assetId:'fixture-audio-a'},{version:'B',assetId:'fixture-audio-b'}]},
    run:{stopRequested:false,snapshot:{artistId:'fixture-artist',music:{route:'manual',versionPolicy:'manual'},outputs:{music:true}}},
    catalog:{works:[]},busy:false,
    status:{materials:[{itemId:'fixture-item-1',workId:'fixture-work-1',workRevision:1,title:'Fixture song',selectedVersion:'A',
      audio:{assetId:'fixture-audio-a',sha256:'audio-a-hash'},
      cover:{assetId:'fixture-cover-a',sha256:'cover-a-hash'},
      lyrics:{plainText:'Fixture lyrics',plainHash:'lyrics-a-hash',alignmentConfirmed:true}}]},
    act(fn){const result=Promise.resolve().then(fn);pending.push(result);return result;},
  };
  function nodes(node){
    if(Array.isArray(node))return node.flatMap(nodes);
    if(!React.isValidElement(node))return[];
    return[node,...nodes(node.props.children)];
  }
  function find(predicate){const result=nodes(tree).find(predicate);assert.ok(result,'expected UI control exists');return result;}
  const checkbox=()=>find(n=>n.type==='input'&&n.props.type==='checkbox');
  const confirm=()=>find(n=>n.type==='button'&&n.props.children==='确认材料并继续');
  const render=()=>{cursor=0;tree=Component(props);return tree;};
  const check=()=>{checkbox().props.onChange({target:{checked:true}});render();};
  const fillRights=()=>{find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic original lyrics, recording and cover are authorized for these exact materials.'}});render();};
  render();
  return{props,calls,render,checkbox,confirm,check,fillRights,materials:()=>props.status.materials[0],
    async submit(){assert.equal(confirm().props.disabled,false,'current declaration enables confirmation');confirm().props.onClick();await Promise.all(pending.splice(0));},
  };
}

function assertInvalidated(f){
  assert.equal(f.checkbox().props.checked,false,'changed material identity must render unchecked immediately');
  assert.equal(f.confirm().props.disabled,true,'changed material identity must disable confirmation until rechecked');
  assert.equal(f.calls.length,0,'props refresh alone must not send a declaration');
}

test('same item preview r2 invalidates r1 declaration and only rechecking submits r2 hashes',async()=>{
  const f=fixture();f.fillRights();f.check();
  assert.equal(f.confirm().props.disabled,false);
  Object.assign(f.materials(),{workRevision:2,cover:{assetId:'fixture-cover-r2',sha256:'cover-r2-hash'},
    lyrics:{plainText:'Updated fixture lyrics',plainHash:'lyrics-r2-hash',alignmentConfirmed:true}});
  f.render();assertInvalidated(f);
  f.check();await f.submit();
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].method,'planCenter.confirmMaterials');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].input)),{
    itemId:'fixture-item-1',expectedWorkRevision:2,audioHash:'audio-a-hash',coverHash:'cover-r2-hash',
    lyricsHash:'lyrics-r2-hash',rightsStatement:'Synthetic original lyrics, recording and cover are authorized for these exact materials.',confirmed:true,
  });
});

const changes=[
  ['item',f=>{f.props.item={...f.props.item,id:'fixture-item-2'};f.materials().itemId='fixture-item-2';}],
  ['work',f=>{f.props.item={...f.props.item,workId:'fixture-work-2'};f.materials().workId='fixture-work-2';}],
  ['work revision',f=>{f.materials().workRevision=2;}],
  ['selected version',f=>{f.props.item={...f.props.item,selectedVersion:'B'};f.materials().selectedVersion='B';}],
  ['audio hash',f=>{f.materials().audio={...f.materials().audio,sha256:'audio-r2-hash'};}],
  ['cover hash',f=>{f.materials().cover={...f.materials().cover,sha256:'cover-r2-hash'};}],
  ['lyrics hash',f=>{f.materials().lyrics={...f.materials().lyrics,plainHash:'lyrics-r2-hash'};}],
];
for(const [name,change]of changes)test(name+' changes require a fresh material declaration',async()=>{
  const f=fixture();f.fillRights();f.check();change(f);f.render();assertInvalidated(f);
  f.check();await f.submit();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].input.itemId,f.props.item.id);
  assert.equal(f.calls[0].input.expectedWorkRevision,f.materials().workRevision);
  assert.equal(f.calls[0].input.audioHash,f.materials().audio.sha256);
  assert.equal(f.calls[0].input.coverHash,f.materials().cover.sha256);
  assert.equal(f.calls[0].input.lyricsHash,f.materials().lyrics.plainHash);
});

test('unchanged material identity survives polling but a user uncheck disables submission',()=>{
  const f=fixture();f.fillRights();f.check();
  f.props.status={materials:[JSON.parse(JSON.stringify(f.materials()))]};f.render();
  assert.equal(f.checkbox().props.checked,true,'equivalent polled objects preserve the current declaration');
  assert.equal(f.confirm().props.disabled,false);
  f.checkbox().props.onChange({target:{checked:false}});f.render();
  assert.equal(f.checkbox().props.checked,false);assert.equal(f.confirm().props.disabled,true);assert.equal(f.calls.length,0);
});
