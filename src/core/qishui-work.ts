import {hash} from './database';
import type {Studio} from './studio';
import {QishuiFillSchema,type QishuiWorkSource} from '../shared/qishui';
export function resolveQishuiWork(s:Studio,raw:unknown):QishuiWorkSource{
 const input=QishuiFillSchema.parse(raw);
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const account=s.get('accounts',input.accountId),work=s.get('works',input.workId);
 if(account.provider!=='qishui')throw Error('ACCOUNT_PROVIDER_MISMATCH');
 if(!s.all('bindings').some(b=>b.accountId===account.id&&b.artistId===work.artistId&&b.status!=='revoked'&&b.targets?.includes('qishui')))throw Error('ACCOUNT_ARTIST_NOT_BOUND');
 const artist=s.get('artists',work.artistId);
 if(artist.name!==input.performer)throw Error('QISHUI_PERFORMER_MISMATCH');
 if(work.isCover===true)throw Error('QISHUI_ORIGINAL_REQUIRED');
 const material=(slot:string,kind:string)=>{
  const a=s.get('assets',work.assets?.[slot]);
  if(a.kind!==kind)throw Error('QISHUI_MATERIAL_REQUIRED');
  const file=s.locate(a.id).file;
  if(kind==='audio'){
   const stream=a.metadata?.streams?.find((x:any)=>x.codec_type==='audio');
   if(!['mp3','wav'].includes(a.ext)||!stream||Number(stream.sample_rate)<44100||stream.channels!==2||a.bytes>200*1024*1024)throw Error('QISHUI_AUDIO_FORMAT');
  }else if(!['jpg','jpeg','png'].includes(a.ext)||a.metadata?.width<1440||a.metadata?.height<1440||!a.metadata?.width||!a.metadata?.height||a.bytes>10*1024*1024)throw Error('QISHUI_COVER_FORMAT');
  return {file,sha256:a.sha256,bytes:a.bytes};
 };
 const instrumental=(work.config?.voice??work.parameters?.voice)==='instrumental';
 const lyrics=instrumental?'':s.lyricService().forWork(work).cleaned;
 if(!instrumental&&!lyrics.trim())throw Error('QISHUI_LYRICS_REQUIRED');
 const source={workId:work.id,artistId:work.artistId,title:work.title,lyrics,instrumental,audio:material('audio_'+input.variant,'audio'),cover:material('cover','image')};
 return {...source,fingerprint:hash({...source,input})};
}
