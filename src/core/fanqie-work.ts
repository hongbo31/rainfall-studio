import {z} from 'zod';
import {hash} from './database';
import type {Studio} from './studio';
export const FanqieWorkSelection=z.strictObject({workId:z.uuid(),variant:z.enum(['A','B'])});
/** Main-only resolution: renderer IDs never become caller-supplied file paths. */
export function resolveFanqieWork(s:Studio,raw:unknown) {
 const selection=FanqieWorkSelection.parse(raw);
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const work=s.get('works',selection.workId);
 if(work.isCover===true)throw Error('FANQIE_MUSIC_TYPE_UNSUPPORTED');
 const resolve=(slot:string,kind:string)=>{
  if(!work.assets?.[slot])throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
  const asset=s.get('assets',work.assets[slot]);if(asset.kind!==kind)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
  return {file:s.locate(asset.id).file,sha256:asset.sha256,bytes:asset.bytes};
 };
 const audio=resolve('audio_'+selection.variant,'audio'),cover=resolve('cover','image');
 const lyrics=s.lyricService().forWork(work).cleaned;
 if(!lyrics.trim())throw Error('FANQIE_LYRICS_INVALID');
 const source={...selection,title:work.title,audio,cover,lyrics,ai:work.ai};
 return {...source,artistId:work.artistId as string,fingerprint:hash(source)};
}
export type FanqieWorkSource=ReturnType<typeof resolveFanqieWork>;
