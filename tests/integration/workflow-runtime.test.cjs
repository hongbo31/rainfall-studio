const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const w=require(process.env.RAINFALL_WORKFLOW_BUNDLE);
test('OS workspace pipe lease excludes second writer and releases without PID timeout stealing',async()=>{
 assert.equal(typeof w.acquireWorkspaceLease,'function');const root=path.resolve('output/test-runs','workflow-lease-'+randomUUID());const first=await w.acquireWorkspaceLease(root);try{await assert.rejects(w.acquireWorkspaceLease(root),/WORKSPACE_ALREADY_OWNED/);}finally{await first.release();}const next=await w.acquireWorkspaceLease(root);await next.release();
});
test('session runtime defaults to exit and needs explicit consent for tray or login effects',()=>{
 assert.equal(typeof w.SessionRuntime,'function');const log=[];const runtime=new w.SessionRuntime({show:()=>log.push('show'),hide:()=>log.push('hide'),tray:enabled=>log.push(['tray',enabled]),login:enabled=>log.push(['login',enabled]),pause:()=>log.push('pause'),quit:()=>log.push('quit')});assert.equal(runtime.closeRequested(),false);assert.deepEqual(log,[]);assert.throws(()=>runtime.configure({backgroundEnabled:true,loginAtStartup:true},false),/RUNTIME_CONSENT_REQUIRED/);assert.deepEqual(log,[]);runtime.configure({backgroundEnabled:true,loginAtStartup:false},true);assert.equal(runtime.closeRequested(),true);runtime.pause();runtime.open();assert.deepEqual(log,[['tray',true],'hide','pause','show']);
});
