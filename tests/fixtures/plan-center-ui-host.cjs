// Isolated synthetic fixture host. Not shipped in the desktop app.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{randomUUID}=require('node:crypto');
require('./offline-only.cjs');
const {Studio}=require(path.resolve('output/unified-plan-integration/core.cjs'));
const {draft}=require('./workflow.cjs');
const root=path.resolve(process.argv[2]);if(!root.includes('output')||!root.includes('plan-center-headless'))throw Error('ISOLATED_FIXTURE_ROOT_REQUIRED');
const s=new Studio(root,'production'),artist=s.all('artists')[0];s.save('artists',{...artist,name:'离线演示创作者'});
const channelId=randomUUID(),textProfile=randomUUID(),musicProfile=randomUUID(),accountId=randomUUID();
s.save('settings',{id:'inbox-channel',enabled:true,revision:1,channel:{id:channelId,workspaceId:randomUUID(),workspaceRef:'offline-demo',artistRefs:{creator:artist.id},seriesRefs:{}}});
for(const [id,kind,providerId,modelId,label] of [[textProfile,'text','deepseek','deepseek-flash','离线文本配置'],[musicProfile,'music','yourmusic','chirp-v6','离线音乐配置']])s.save('settings',{id:'api-profile:'+id,kind,providerId,modelId,label,revision:1,executionEnabled:false});
s.save('accounts',{id:accountId,provider:'tme',label:'离线演示账号',authStatus:'unavailable',scopes:[],identitySource:'synthetic-fixture'});
let tail=Promise.resolve();readline.createInterface({input:process.stdin}).on('line',line=>{tail=tail.then(async()=>{const q=JSON.parse(line);try{let value;if(q.method==='runtime')value={appVersion:'0.10.0-preview.1',packaged:false,mode:'production',previewFixture:true};else if(q.method==='__fixture.materials')value=await require('./plan-ui-materials.cjs')(s);else if(q.method==='__fixture.tick')value=require(path.resolve('output/unified-plan-integration/core.cjs')).tickPlanCenter(s);else if(q.method==='__fixture.asset'){const loc=s.locate(q.input.id);value={mime:s.get('assets',q.input.id).mime,base64:fs.readFileSync(loc.file).toString('base64')}}else if(q.method==='__fixture.state')value=s.planCenterService().list();else value=await s.call(q.method,q.input??{});process.stdout.write(JSON.stringify({id:q.id,result:{ok:true,value}})+'\n')}catch(e){process.stdout.write(JSON.stringify({id:q.id,result:{ok:false,error:{code:e.message,message:e.message}}})+'\n')}})}).on('close',()=>tail.finally(()=>s.close()));
