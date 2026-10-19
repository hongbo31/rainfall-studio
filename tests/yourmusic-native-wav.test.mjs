import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {YourMusicAdapter}=require('../build/yourmusic-native.cjs');
const id='e59d6bd9-f5cd-4c11-a320-6169fbf3c358';
test('native WAV uses exact documented song ID and rejects another output or host',async()=>{
 let request;const adapter=new YourMusicAdapter({source:'external',credential:async()=> 'test-only',request:async r=>{request=r;return{status:200,body:{id,audio_wav_url:'https://oss.yourmusic.fun/a.wav'}}}});
 assert.equal((await adapter.nativeWav(id)).id,id);assert.equal(request.url,'https://api.yourmusic.fun/v1/music/generations/wav');assert.deepEqual(request.body,{songid:id});
 const wrong=new YourMusicAdapter({source:'external',credential:async()=> 'test-only',request:async()=>({status:200,body:{id:'wrong',audio_wav_url:'https://oss.yourmusic.fun/a.wav'}})});await assert.rejects(()=>wrong.nativeWav(id),/OUTPUT_ID_MISMATCH/);
 const host=new YourMusicAdapter({source:'external',credential:async()=> 'test-only',request:async()=>({status:200,body:{id,audio_wav_url:'https://other.invalid/a.wav'}})});await assert.rejects(()=>host.nativeWav(id),/DOWNLOAD_URL_REJECTED/);
});
