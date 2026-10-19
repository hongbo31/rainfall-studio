const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),sharp=require('sharp');
require('./offline-only.cjs');
const api=require(path.resolve('output/plan-cover-recovery/core.cjs')),root=path.resolve(process.argv[2]);
if(!root.includes(path.join('output','playwright','plan-cover-recovery-')))throw Error('ISOLATED_FIXTURE_ROOT_REQUIRED');
const s=new api.Studio(root,'production'),x=require('./plan-cover-recovery.cjs')(s,api);api.tickPlanCenter(s);
let queue=Promise.resolve();readline.createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(async()=>{const q=JSON.parse(line);try{let value;
 if(q.method==='runtime')value={appVersion:require('../../package.json').version,packaged:false,mode:'production',previewFixture:true};
 else if(q.method==='__fixture.state')value={...s.planCenterService().list(),operations:s.all('operations'),externalRequests:s.externalRequests,works:s.all('works')};
 else if(q.method==='__fixture.tick')value=api.tickPlanCenter(s);
 else if(q.method==='__fixture.stopped'){const other=require('./plan-cover-recovery.cjs')(s,api);value=await s.call('planCenter.prepareCoverWork',other.input);other.center.stop({runId:other.run.id});}
 else if(q.method==='__fixture.import'){const file=path.join(root,'synthetic-local-cover.png');await sharp({create:{width:512,height:512,channels:3,background:'#436b86'}}).png().toFile(file);value=await s.coverHandoff().receiveFile(file,q.input.workId,q.input.requestId,'image');}
 else if(q.method==='__fixture.asset'){const loc=s.locate(q.input.id);value={mime:loc.mime,base64:fs.readFileSync(loc.file).toString('base64')};}
 else if(q.method==='__fixture.export'){value=s.coverHandoff().exportRequest(q.input.requestId);fs.writeFileSync(path.join(root,'cover-request.json'),JSON.stringify(value,null,2));}
 else value=await s.call(q.method,q.input??{});
 process.stdout.write(JSON.stringify({id:q.id,result:{ok:true,value}})+'\n');}catch(e){process.stdout.write(JSON.stringify({id:q.id,result:{ok:false,error:{code:e.message,message:e.message}}})+'\n');}})}).on('close',()=>queue.finally(()=>s.close()));
