// Original local QA materials only; never reads production state or creates credentials.
const fs=require('node:fs'),path=require('node:path');
const sharp=require('sharp');
const {Studio}=require('../build/core.cjs');
(async()=>{
 const out=path.resolve('output/native-acceptance'),root=path.join(out,'fixture-data-'+Date.now());
 if(fs.existsSync(root))throw Error('FRESH_FIXTURE_REQUIRED');
 fs.mkdirSync(path.join(out,'original-fixtures'),{recursive:true});
 const seconds=61,rate=44100,b=Buffer.alloc(44+seconds*rate*2);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 for(let i=0;i<seconds*rate;i++)b.writeInt16LE(Math.round(1200*Math.sin(i*2*Math.PI*220/rate)),44+i*2);
 const audio=path.join(out,'original-fixtures','isolated-test-tone.wav');fs.writeFileSync(audio,b);
 const cover=path.join(out,'original-fixtures','original-test-cover.png');
 await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#201631"/><stop offset="1" stop-color="#8c698f"/></linearGradient></defs><rect width="1600" height="1600" fill="url(#g)"/><circle cx="800" cy="660" r="320" fill="#cfb1c8" opacity=".3"/><path d="M0 1160 Q800 650 1600 1080 L1600 1600H0" fill="#17151f"/><text x="130" y="1380" fill="#f6edf8" font-size="80">ISOLATED QA / ORIGINAL TEST ASSET</text></svg>')).png().toFile(cover);
 const s=new Studio(root,'production');
 try{
  const artist=s.all('artists')[0];s.save('artists',{...artist,name:'隔离验收艺人'});
  const account=await s.call('account.save',{provider:'tme',name:'本地夹具账号 · 未绑定',dailyLimit:1});
  for(const target of ['qqmusic','kugou']){const c=(await s.call('platformConfig.list')).find(c=>c.target===target);const {revision,version,...config}=c;await s.call('platformConfig.save',{expectedRevision:revision,config:{...config,accountId:account.id,artistId:artist.id,lyricist:'夹具作者',composer:'夹具作者',album:'原生隔离验收'}});}
  const ids={};
  for(const [key,title] of [['complete','隔离新作 · 本地测试音'],['missing','隔离缺素材 · 不可发布'],['protectedA','把晚安留在门口'],['protectedB','留一盏灯']]){
   const w=s.saveWork({title,artistId:artist.id,story:'原创隔离验收数据，音频仅为本地合成测试音。',lyrics:'这是隔离验收歌词\n不会上传到任何平台',prompt:'仅本地测试',parameters:{language:'国语',genre:'流行'},rights:'原创测试夹具，仅用于本机验收',ai:'generated'});ids[key]=w.id;
   if(key==='complete'){
    await s.importFile(audio,'audio_A',w.id);await s.importFile(cover,'cover',w.id);
    const l=await s.call('lyrics.preview',{workId:w.id});await s.call('lyrics.confirm',{workId:w.id,versionId:l.versionId,plainHash:l.plainHash,audioHash:l.audioHash,confirmed:true});
    const current=s.get('works',w.id);s.save('works',{...current,publicationMetadata:{title,albumTitle:'原生隔离验收',albumDescription:'仅本地合成测试音；不是平台投稿素材。',artistName:'隔离验收艺人',lyricist:'夹具作者',composer:'夹具作者',ownLyrics:true,ownComposition:true,aiTool:'本地夹具（未调用AI）',generatedOn:'2026-10-18',allowCover:false,genre:'流行',language:'国语',version:'完整版',releaseMode:'审核通过即发布'}});
   }
  }
  fs.writeFileSync(path.join(out,'fixture.json'),JSON.stringify({root,ids,accountId:account.id,source:'original-local-qa-only',syntheticTone:true},null,2));
  console.log(JSON.stringify({root,works:4,realAccounts:0,source:'original-local-qa-only'}));
 }finally{s.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
