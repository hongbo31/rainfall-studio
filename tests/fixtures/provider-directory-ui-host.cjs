// QA-only host: actual Core + actual provider broker, fixed synthetic transport, no credential vault.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{randomUUID}=require('node:crypto');
const deny=()=>{throw Error('QA_EXTERNAL_NETWORK_FORBIDDEN')};globalThis.fetch=deny;for(const n of ['node:http','node:https']){const mod=require(n);mod.request=deny;mod.get=deny;}
const root=path.resolve(process.argv[2]);if(!root.startsWith(path.resolve('output/provider-directory-acceptance')+path.sep))throw Error('ISOLATED_QA_DATA_ROOT_REQUIRED');
const {Studio}=require(path.resolve('build/core.cjs'));const m=require(path.resolve('output/provider-directory-acceptance/qa.cjs'));
const s=new Studio(root,'production');const requests=path.join(path.dirname(root),'task-input');fs.mkdirSync(requests,{recursive:true});let providerCalls=0;
const draft={title:'雨后把路走慢',topic:'日常相遇',storyBeat:'雨后的街口从相识到熟悉',language:'中文',style:'温柔流行，木吉他与钢琴',instrumental:false,sections:[{id:'v1',kind:'Verse',lines:['雨后的街口还亮着灯','你把晚风留在了伞中']},{id:'c1',kind:'Chorus',lines:['把顺路走成明天','把日常唱成思念']}],hook:{sectionId:'c1',startLine:0,endLine:2},vocalPlan:[{sectionId:'v1',voice:'male'},{sectionId:'c1',voice:'male'}],musicPrompts:{suno:{positiveStyle:'Mandarin original gentle acoustic pop, warm male vocal, guitar and piano, 88 BPM',negativeStyle:'',durationTarget:180,voiceArrangement:'male'},yourmusic:{positiveStyle:'Mandarin original gentle acoustic pop, warm male vocal, guitar and piano, 88 BPM',negativeStyle:'',durationTarget:180,voiceArrangement:'male'}},continuityNotes:'离线测试原创新文本，无音频'};
const rpc=async(method,input={})=>{try{let value;
 if(method.startsWith('internal.providerText.')){const service=s.providerTextService(),action=method.slice('internal.providerText.'.length);value=action==='list'?service.list():action==='context'?service.context(input.id):action==='stop'?service.stop(input.ownerKey):service[action](input);}
 else value=await s.call(method,input);return{ok:true,value};
 }catch(e){return{ok:false,error:{code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'QA_OPERATION_FAILED',message:e.message}}}};
const broker=m.createProviderTextBroker({available:()=>true,generation:()=>1,rpc,credentials:{apiCredentialStatus:async()=>({configured:true,state:'stored_unverified'}),withProviderTextAdapter:async(identity,fn,guard)=>fn(new m.ProviderTextAdapter({credential:async()=> 'QA_MEMORY_MARKER_NEVER_A_REAL_KEY',assertActive:guard,request:async req=>{
 providerCalls++;const user=JSON.parse(req.body.messages[1].content);const isScore=req.body.messages[0].content.startsWith('Evaluate');let content;
 if(isScore){content={revisionId:user.revisionId??user.pair?.revisionId,dimensions:{lyrics:86,style:84,coherence:87},findings:['歌词中的“雨后的街口”提供了具体的生活场景并保持叙事关系清晰。']};}
 else content=draft;
 return{status:200,body:{id:'qa-response-'+providerCalls,model:req.body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:40,completion_tokens:200,prompt_tokens_details:{cached_tokens:0},prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:40}}};
 }}))}});
let tail=Promise.resolve();readline.createInterface({input:process.stdin}).on('line',line=>{tail=tail.then(async()=>{const q=JSON.parse(line);let result;try{let value;
 if(q.method==='runtime')value={appVersion:require(path.resolve('package.json')).version,mode:'production',packaged:false,root,qaIsolation:true,versions:process.versions};
 else if(q.method==='__qa.chooseDirectory')value=s.directoryTasks().configureDirectory({...q.input,expectedRevision:q.input.expectedRevision??null,root:requests});
 else if(q.method==='__qa.writeRequest'){const source=s.directoryTasks().status().sources.find(x=>x.id===q.input.sourceId);if(!source)throw Error('QA_SOURCE_REQUIRED');const file={schemaVersion:1,requestId:q.input.requestId??'experience-001',revision:q.input.revision??1,planId:source.planId,planRevision:source.planRevision};fs.writeFileSync(path.join(requests,'experience.rainfall-request.json'),JSON.stringify(file,null,2));value={written:true,file:path.join(requests,'experience.rainfall-request.json')};}
 else if(q.method==='__qa.tick'){await s.tick();value=s.directoryTasks().status();}
 else if(q.method==='__qa.pump'){await s.tick();value=await broker.pump();await s.tick();}
 else if(q.method==='__qa.calls')value={providerCalls,realNetworkCalls:0,credentialsWritten:false};
 else if(q.method==='__qa.asset'){const loc=s.locate(q.input.id);value={mime:s.get('assets',q.input.id).mime,base64:fs.readFileSync(loc.file).toString('base64')};}
 else if(q.method==='__qa.state')value={plans:s.planCenterService().list(),jobs:s.providerTextService().list(),directory:s.directoryTasks().status(),works:s.all('works')};
 else if(q.method==='__qa.quiesce'){for(const src of s.directoryTasks().status().sources)if(src.enabled)s.directoryTasks().pause({id:src.id,expectedRevision:src.revision});for(const p of s.planCenterService().list().plans)if(p.enabled)s.planCenterService().toggle({id:p.id,expectedRevision:p.revision,enabled:false});value={paused:true};}
 else{result=await rpc(q.method,q.input??{});}
 if(!result)result={ok:true,value};
 }catch(e){result={ok:false,error:{code:e.message,message:e.message}}}process.stdout.write(JSON.stringify({id:q.id,result})+'\n');});}).on('close',()=>tail.finally(()=>{broker.stop();s.close()}));
