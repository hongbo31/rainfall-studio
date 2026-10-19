const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {backup,restore,zip,Repository}=require(process.env.RAINFALL_BACKUP_LONGPATH_BUNDLE);
require('node:net').Socket.prototype.connect=function(){throw Error('NO_EXTERNAL_NETWORK')};

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function workspace(t){
 const base=path.resolve(process.env.RAINFALL_BACKUP_LONGPATH_OUTPUT,'fixtures',randomUUID());
 const root=path.join(base,'r'.repeat(Math.max(1,224-base.length-1)));
 const filename=path.join(root,'studio.sqlite');
 assert.ok(filename.length<260,'live SQLite path remains within its native plain-path limit');
 assert.ok(path.join(root,'staging','backup-'+randomUUID(),'database.sqlite').length>260,'snapshot SQLite path exceeds the Windows plain-path limit');
 const s={root,mode:'production',repo:new Repository(filename),now:()=>new Date('2026-10-19T12:00:00Z'),get db(){return this.repo.db},all(table){return this.repo.all(table)}};
 t.after(()=>s.repo.close());
 s.repo.save('settings',{id:'marker',value:'snapshot WAL content'});
 s.repo.save('approvals',{id:'ephemeral-approval',approved:true});
 s.repo.save('plans',{id:'fixture-plan',enabled:true});
 const bytes=Buffer.from('isolated-media-fixture\n'),hash=sha(bytes),name=`media/sha256/${hash.slice(0,2)}/${hash}.bin`,file=path.join(root,name);
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
 s.repo.save('assets',{id:'fixture-media',kind:'audio',sha256:hash,ext:'bin'});
 return{s,root,bytes,name,file};
}

test('long workspace paths back up WAL content and restore verified media while freezing approvals and plans',async t=>{
 const {s,root,bytes,file}=workspace(t),archive=path.join(root,'backup.zip');
 const result=await backup(s,archive);
 assert.equal(result.sha256,sha(fs.readFileSync(archive)));
 assert.equal(result.assets,1);
 assert.equal(s.repo.get('approvals','ephemeral-approval').approved,true,'snapshot approval removal must not mutate the live source');
 s.repo.save('settings',{id:'marker',value:'changed after snapshot'});
 // This fixture file is expendable; prove restore actually recreates its exact bytes.
 fs.unlinkSync(file);
 const restored=await restore(s,archive);
 assert.equal(restored.restored,true);
 assert.equal(s.repo.get('settings','marker').value,'snapshot WAL content');
 assert.deepEqual(fs.readFileSync(file),bytes);
 assert.deepEqual(s.repo.all('approvals'),[]);
 assert.equal(s.repo.get('plans','fixture-plan').enabled,false);
 assert.equal(s.repo.db.pragma('integrity_check',{simple:true}),'ok');
 assert.ok(fs.existsSync(restored.previous),'prior live database is retained for recovery');
 assert.equal(s.repo.get('assets','fixture-media').sha256,sha(bytes));
});

test('long-path restore rejects modified archived bytes and preserves the current database and media',async t=>{
 const {s,root,bytes,name,file}=workspace(t),archive=path.join(root,'tampered.zip'),db=path.join(root,'fixture.sqlite');
 await s.db.backup(db);
 const dbBytes=fs.readFileSync(db),manifest={formatVersion:1,schemaVersion:3,mode:s.mode,files:[{name:'database.sqlite',bytes:dbBytes.length,sha256:sha(dbBytes)},{name,bytes:bytes.length,sha256:sha(bytes)}]};
 await zip(archive,[{name:'database.sqlite',file:db},{name,text:'x'.repeat(bytes.length)},{name:'manifest.json',text:JSON.stringify(manifest)}]);
 await assert.rejects(()=>restore(s,archive),/BACKUP_HASH/);
 assert.equal(s.repo.get('settings','marker').value,'snapshot WAL content');
 assert.deepEqual(fs.readFileSync(file),bytes);
 assert.equal(s.repo.get('approvals','ephemeral-approval').approved,true);
});
