import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Studio} from './studio';
const prefix='cover-inbox:';
const names=['cover.png','cover.jpg','cover.jpeg','cover.webp'];
export function preparePlanCoverInbox(s:Studio,itemId:string,workId:string){
 const key='plan-cover-inbox:'+itemId;
 let binding=s.repo.maybe('settings',key)?.value;
 if(!binding){binding={workId,requestId:randomUUID()};s.save('settings',{id:key,value:binding});}
 if(binding.workId!==workId)throw Error('COVER_SCOPE_MISMATCH');
 s.coverHandoff().request({workId,requestId:binding.requestId,brief:''});
 return watchCoverInbox(s,binding.requestId);
}
function folder(s:Studio,workId:string,requestId:string){
  z.uuid().parse(workId);z.uuid().parse(requestId);
  let current=s.root;
  for(const part of ['cover-inbox',workId,requestId]){
    current=path.join(current,part);
    if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('COVER_INBOX_LINK_REJECTED');
    fs.mkdirSync(current,{recursive:true});
  }
  return current;
}
export function watchCoverInbox(s:Studio,requestId:string){
  const request=s.coverHandoff().exportRequest(requestId);
  const directory=folder(s,request.workId,request.id);
  const old=s.repo.maybe('settings',prefix+request.id)?.value;
  if(old)return old;
  fs.writeFileSync(path.join(directory,'request.json'),JSON.stringify(request,null,2));
  fs.writeFileSync(path.join(directory,'保存图片说明.txt'),[
    `作品：${request.context.title}`,`作品 ID：${request.workId}`,
    '将这一首的正方形封面保存到本目录，文件名为 cover.png（也支持 cover.jpg / cover.jpeg / cover.webp）。',
    '只放一张图片，建议 3000×3000。客户端运行时自动接收并选为本首封面。',
    '匹配依据是本目录对应的作品 ID 与请求 ID，不按相似歌名猜测。不要把其他作品图片放入这里。',
    '保存过程中请先用其他文件名，写完后再改成 cover.png。源图片保留；更新歌词后需重新创建目录。',
    '生图服务或外部工具也可将最终图片写入这里；request.json 内含本首提示词。',
  ].join('\r\n'));
  for(const row of s.repo.all('settings').filter(r=>r.id.startsWith(prefix)&&r.value?.workId===request.workId&&r.value?.state==='waiting'))
    s.save('settings',{...row,value:{...row.value,state:'superseded'}});
  const value={requestId:request.id,workId:request.workId,directory,state:'waiting',expectedNames:names,createdAt:s.now().toISOString()};
  s.save('settings',{id:prefix+request.id,value});return value;
}
export function coverInboxStatus(s:Studio,workId?:string){
  return s.repo.all('settings').filter(r=>r.id.startsWith(prefix)&&(!workId||r.value?.workId===workId)).map(r=>r.value);
}
export async function scanCoverInbox(s:Studio){
  for(const state of coverInboxStatus(s).filter(r=>r.state==='waiting')){
    try{
      const directory=folder(s,state.workId,state.requestId);
      const files=names.filter(name=>fs.existsSync(path.join(directory,name)));
      if(!files.length)continue;
      if(files.length!==1)throw Error('COVER_INBOX_MULTIPLE_IMAGES');
      const file=path.join(directory,files[0]),info=fs.lstatSync(file);
      if(!info.isFile()||info.isSymbolicLink())throw Error('COVER_INBOX_FILE_REJECTED');
      if(Date.now()-info.mtimeMs<2000)continue;
      if(info.size>50*1024**2)throw Error('COVER_INBOX_FILE_TOO_LARGE');
      const receipt=await s.coverHandoff().receiveFile(file,state.workId,state.requestId,'image');
      await s.call('work.selectAsset',{workId:state.workId,role:'cover',assetId:receipt.assetId});
      s.save('settings',{id:prefix+state.requestId,value:{...state,state:'received',assetId:receipt.assetId,receiptId:receipt.id,reason:null,receivedAt:s.now().toISOString()}});
    }catch(e){
      const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'COVER_INBOX_IMAGE_INVALID';
      if(state.reason!==reason)s.save('settings',{id:prefix+state.requestId,value:{...state,reason}});
    }
  }
}
