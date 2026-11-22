import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {digest,ffmpeg,probe} from '../../core/assets';
import {assertPublicationFile} from '../../core/publication-foundation';
import type {FanqieWorkSource} from '../../core/fanqie-work';
import type {FanqieAssets} from '../../shared/fanqie';
const run=promisify(execFile);
/** Publication derivatives only. Originals and library metadata remain unchanged. */
export async function prepareFanqieWorkMaterials(root:string,source:Pick<FanqieWorkSource,'title'|'audio'|'cover'|'lyrics'|'instrumental'>,guard:()=>void,directoryUpload=false) {
 guard();for(const asset of [source.audio,source.cover])assertPublicationFile(asset,{error:'FANQIE_ASSET_CHANGED',rejectSymlinks:true});
 const metadata=probe(source.audio.file),streams=metadata.streams?.filter((stream:any)=>stream.codec_type==='audio');
 const audio=streams?.[0],duration=Number(metadata.format?.duration),rate=Number(audio?.sample_rate);
 if(streams?.length!==1||!Number.isFinite(duration)||duration<=30||duration>1800||audio?.channels!==2||!Number.isFinite(rate)||rate<44100||rate>192000)throw Error('FANQIE_AUDIO_PROPERTIES');
 // Read the download into memory so the image cache does not hold its original file open.
 const coverInput=directoryUpload?fs.readFileSync(source.cover.file):source.cover.file;
 const image=sharp(coverInput,{limitInputPixels:100_000_000});
 const cover=await image.metadata();guard();
 if(!cover.width||cover.width!==cover.height||(cover.pages??1)!==1)throw Error('FANQIE_COVER_DIMENSIONS');
 const folder=path.join(root,'prepared','fanqie',randomUUID());
 for(let parent=folder;parent!==path.dirname(parent);parent=path.dirname(parent))if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('FANQIE_BUNDLE_INVALID');
 fs.mkdirSync(folder,{recursive:true});
 const stem=String(source.title).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,80)||'歌曲';
 const copyMP3=directoryUpload&&path.extname(source.audio.file).toLowerCase()==='.mp3';
 const files={audio:path.join(folder,stem+(copyMP3?'.mp3':'.wav')),cover:path.join(folder,stem+'-封面.jpg'),
  ...(source.instrumental?{}:{lyrics:path.join(folder,stem+'-歌词.txt')})};
 if(copyMP3)fs.copyFileSync(source.audio.file,files.audio,fs.constants.COPYFILE_EXCL);
 else await run(ffmpeg,['-nostdin','-v','error','-n','-protocol_whitelist','file,pipe','-i',source.audio.file,'-map','0:a:0','-vn','-c:a','pcm_s16le','-ar',String(rate),'-ac','2',files.audio],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 guard();
 await image.resize(Math.max(1440,Math.min(cover.width,2048))).jpeg({quality:95}).toFile(files.cover);guard();
 if(files.lyrics)fs.writeFileSync(files.lyrics,source.lyrics,'utf8');
 for(const asset of [source.audio,source.cover])assertPublicationFile(asset,{error:'FANQIE_ASSET_CHANGED',rejectSymlinks:true});
 return Object.fromEntries(Object.entries(files).map(([role,file])=>[role,{file,bytes:fs.statSync(file).size,sha256:digest(file)}])) as FanqieAssets;
}
