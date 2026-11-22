import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer,type IncomingMessage} from 'node:http';
import {z} from 'zod';
import {publicationTaskSchemas} from '../shared/publication-tasks';

const requestSchema=z.strictObject({
  channel:z.enum(['call','fanqieCatalog','fanqieUpload']),
  method:z.string().max(80),
  input:z.unknown(),
});
export type WorkbenchRequest=z.infer<typeof requestSchema>;
const routes={
  call:new Set(['snapshot','publish.selection.save','publish.simple','work.selectAudioVersion','publish.reconcile','accountSession.open','publish.qishui.prepare',
    ...Object.keys(publicationTaskSchemas)]),
  fanqieCatalog:new Set(['status','open','read']),
  fanqieUpload:new Set(['status','configuration','publishBatch','reconcile','authorizeExisting']),
};
async function readRequest(request:IncomingMessage){
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of request){
    size+=chunk.length;
    if(size>64*1024)throw Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

export function startPublishWorkbench(ui:string,dispatch:(request:WorkbenchRequest)=>Promise<any>){
  const key=randomBytes(32).toString('hex');
  let origin='';
  const server=createServer(async(req,res)=>{
    const fail=(status:number)=>{res.writeHead(status);res.end();};
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try{
      if(!origin||req.headers.host!==new URL(origin).host)return fail(403);
      if(req.method==='POST'&&req.url==='/rpc'){
        if(req.headers.origin!==origin||req.headers.authorization!=='Bearer '+key||
          req.headers['content-type']!=='application/json')return fail(403);
        const action=await readRequest(req);
        if(!routes[action.channel].has(action.method))return fail(403);
        const result=await dispatch(action);
        res.setHeader('Content-Type','application/json; charset=utf-8');
        return res.end(JSON.stringify(result));
      }
      if(req.method==='GET'&&req.url==='/favicon.ico')return fail(204);
      if(req.method!=='GET')return fail(405);
      const name=req.url==='/'?'index.html':req.url?.slice(1)??'';
      if(!/^(?:index\.html|assets\/[a-zA-Z0-9_-]+\.(?:js|css))$/.test(name))return fail(404);
      const contents=await fs.readFile(path.join(ui,name));
      res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':
        name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      res.end(name==='index.html'?contents.toString('utf8').replace("connect-src 'none'","connect-src 'self'"):contents);
    }catch{if(!res.headersSent)fail(400);else res.end();}
  });
  server.requestTimeout=30_000;
  const ready=new Promise<string>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      if(!address||typeof address==='string')return reject(Error('WORKBENCH_LISTEN_FAILED'));
      origin='http://127.0.0.1:'+address.port;
      resolve(origin+'/#'+key);
    });
  });
  return {ready,close:()=>server.close()};
}
