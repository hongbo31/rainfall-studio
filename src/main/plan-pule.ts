import type {ApiCredentials} from './api-credentials';
import {planPuleReleaseIndex,type PlanPuleReceipt,type PlanPuleTask} from '../shared/plan-pule';

type ClaimedTask=PlanPuleTask&{
  attemptId:string;profileId:string;profileRevision:number;modelId:string;
  prompt:string;cover:boolean;receipt?:PlanPuleReceipt;
};
type Options={
  rpc:(method:string,input?:unknown)=>Promise<any>;
  credentials:ApiCredentials;
  available:()=>boolean;
  generation:()=>number;
};

/** Plan Center records every paid dispatch. A lost response pauses that run. */
export function createPlanPuleRunner(options:Options){
  let busy=false;
  const rpc=async(action:string,input:unknown={})=>{
    const result=await options.rpc('internal.planPule.'+action,input);
    if(!result.ok)throw Error(result.error?.code??'PLAN_MUSIC_RPC_FAILED');
    return result.value;
  };
  return {
    async pump(){
      if(busy||!options.available())return;
      busy=true;
      const generation=options.generation();
      const current=()=>options.available()&&generation===options.generation();
      const guard=()=>{if(!current())throw Error('WORKSPACE_CHANGED');};
      try{
        const tasks:PlanPuleTask[]=await rpc('list');
        const next=tasks[0];
        if(!next||!current())return;
        const task:ClaimedTask=await rpc('claim',next);
        const scope={...next,attemptId:task.attemptId};
        const check=async()=>{guard();await rpc('current',scope);guard();};
        const record=(status:string,reason?:string,receipt?:PlanPuleReceipt)=>rpc('record',{...scope,status,reason,receipt});
        let paid=false;
        try{
          const identity={profileId:task.profileId,expectedRevision:task.profileRevision};
          const status=await options.credentials.apiCredentialStatus({profileId:task.profileId});
          if(!status.configured){await record('failed','CREDENTIAL_REQUIRED');return;}
          await options.credentials.withMusicAdapter(identity,async adapter=>{
            await check();
            if(task.stage==='music_submit'){
              const result=await adapter.submitPrompt({prompt:task.prompt,modelId:task.modelId},async()=>{
                await check();paid=true;
              });
              if(result.state==='accepted')
                await record('succeeded',undefined,{trackingId:result.trackingId,songIds:result.songIds});
              else await record(result.state,result.reason);
              return;
            }
            const {songIds}=task.receipt!;
            const result=await adapter.query(songIds);
            const songs=songIds.map(id=>result.songs?.find((song:any)=>song.id===id));
            if(result.state!=='known'||songs.some(song=>song?.status!=='succeeded'&&song?.status!=='failed')){
              await record('waiting','ORIGINAL_ASSETS_PENDING');return;
            }
            const originals=songs.map(song=>song?.status==='succeeded'&&song.audio_url&&!song.has_watermark&&
              (!song.audio_delivery_status||song.audio_delivery_status==='original')?
              {...song,lyrics:song.lyric??''}:null);
            const selected=originals[planPuleReleaseIndex(originals)];
            if(!selected){
              await record('failed',originals.some(Boolean)?'MUSIC_OUTPUT_TEXT_INVALID':'MUSIC_PROVIDER_FAILED');
              return;
            }
            const assets=[];
            for(const song of originals){
              if(!song){assets.push(null);continue;}
              await check();
              const audio=await adapter.download(song.audio_url!);
              assets.push({id:song.id,title:song.title??'',lyrics:song.lyrics,bytes:new Uint8Array(audio.bytes),mime:audio.mime});
            }
            await check();
            const coverUrl=selected.image_url;
            let cover:Uint8Array|undefined;
            if(task.cover&&coverUrl){
              try{cover=new Uint8Array(await adapter.downloadCover(coverUrl));}
              catch{await check();/* Core renders original local artwork. */}
            }
            await check();
            await rpc('assets',{...scope,songs:assets,cover});
          },guard);
        }catch(error){
          if(!current())return;
          const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PLAN_MUSIC_FAILED';
          await record(paid?'unknown':'failed',paid?'MUSIC_OUTCOME_UNKNOWN':reason);
        }
      }finally{busy=false;}
    },
  };
}
