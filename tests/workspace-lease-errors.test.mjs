import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
const outfile=path.resolve('output/lease-errors/runtime.cjs');
await build({entryPoints:['src/main/session-runtime.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
const {acquireWorkspaceLease}=createRequire(import.meta.url)(outfile);
for(const code of ['EPERM','EACCES','EMFILE','EADDRINUSE'])test(`workspace lease preserves ${code} diagnosis`,async()=>{
 const original=net.createServer;
 const failure=Object.assign(Error(`listen ${code}`),{code});
 net.createServer=()=>{const server=new EventEmitter();server.listen=()=>queueMicrotask(()=>server.emit('error',failure));return server;};
 try{await assert.rejects(acquireWorkspaceLease('/tmp/lease-error-test'),error=>code==='EADDRINUSE'?error.message==='WORKSPACE_ALREADY_OWNED'&&error.cause===failure:error===failure);}finally{net.createServer=original;}
});
