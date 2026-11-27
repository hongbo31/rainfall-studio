import {z} from 'zod';
import {workRecordingSinger} from '../shared/local-artist';
import {workVersionCover,workVersionTitle,type WorkVersionSlot} from '../shared/work-versions';
import {cleanLyricText} from '../shared/tme-lyrics';
import {hash} from './database';
import type {Studio} from './studio';
export const FanqieWorkSelection=z.strictObject({workId:z.uuid(),variant:z.enum(['A','B']),useVersionMetadata:z.literal(true).optional()});
export type FanqieWorkSelection=z.infer<typeof FanqieWorkSelection>;
/** Main-only resolution: renderer IDs never become caller-supplied file paths. */
export function resolveFanqieWork(s:Studio,raw:unknown) {
 const selection=FanqieWorkSelection.parse(raw);
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const work=s.get('works',selection.workId);
 const artist=s.repo.maybe('artists',work.artistId);
 const profile=artist?.accountLocalArtist ? artist.profile : null;
 const credits=profile ? {lyricist:profile.lyricist,composer:profile.composer,singer:workRecordingSinger(work,artist,selection.variant)??profile.singer} : undefined;
 if(work.isCover===true)throw Error('FANQIE_MUSIC_TYPE_UNSUPPORTED');
 const resolve=(assetId:string|undefined,kind:string)=>{
  if(!assetId)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
  const asset=s.get('assets',assetId);if(asset.kind!==kind)throw Error('FANQIE_WORK_MATERIALS_REQUIRED');
  return {file:s.locate(asset.id).file,sha256:asset.sha256,bytes:asset.bytes};
 };
 const slot:WorkVersionSlot=`audio_${selection.variant}`,audioId=work.assets?.[slot];
 const versionWork={title:work.title,alternateTitle:work.alternateTitle,assets:work.assets};
 const coverId=selection.useVersionMetadata?workVersionCover(versionWork,slot)??work.assets?.cover:work.assets?.cover;
 const audio=resolve(audioId,'audio'),cover=resolve(coverId,'image');
 const instrumental=work.config?.voice==='instrumental';
 const actual=selection.useVersionMetadata
  ?work.audioVersions?.find((row:{assetId:string})=>row.assetId===audioId)?.actualLyrics?.text:undefined;
 const lyrics=actual!==undefined?cleanLyricText(actual).cleaned:s.lyricService().forWork(work).cleaned;
 const title=selection.useVersionMetadata?workVersionTitle(versionWork,slot):work.title;
 const source={...selection,title,audio,cover,lyrics,ai:work.ai,...(instrumental?{instrumental:true as const}:{})};
 return {...source,artistId:work.artistId as string,fingerprint:hash(source),...(credits?{credits}:{})};
}
export type FanqieWorkSource=ReturnType<typeof resolveFanqieWork>;
