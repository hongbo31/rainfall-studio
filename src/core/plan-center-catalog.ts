import {hasPlanAlbumAdapter} from '../shared/plan-albums';
import type { Repository } from './database';
import {planModelCatalog} from './plan-center-models';

// Describes installed code and saved declarations, never a live provider discovery result.
// Native providers must supply a fresh trusted catalog before an album/model is executable.
export function planCatalog(repo: Repository) {
  const profiles = repo.settingsByPrefix('api-profile:').map(p => ({
    id:p.id.slice('api-profile:'.length), label:p.label, kind:p.kind,
    providerId:p.providerId, modelId:p.modelId, revision:p.revision, textPricing:p.textPricing??null,
  }));
  const models=planModelCatalog(repo);
  const unavailable = (reason:string) => ({available:false,reason});
  const platforms = [
    {id:'netease',label:'网易云音乐',delivery:'audio',accountProviders:['netease']},
    {id:'qishui',label:'汽水音乐',delivery:'audio',accountProviders:['qishui']},
    {id:'qqmusic',label:'QQ 音乐',delivery:'audio',accountProviders:['qqmusic','tme']},
    {id:'kugou',label:'酷狗音乐',delivery:'audio',accountProviders:['kugou','tme']},
    {id:'douyin',label:'抖音',delivery:'video',accountProviders:['douyin']},
  ].map(p => ({...p,albumAdapterImplemented:hasPlanAlbumAdapter(p.id),
    catalog:{...unavailable(hasPlanAlbumAdapter(p.id)?'ACCOUNT_SCOPED_ALBUM_CATALOG_REQUIRED':'PLATFORM_ALBUM_ADAPTER_NOT_IMPLEMENTED'),albums:[],source:'unavailable'},
    albumCreate:unavailable(hasPlanAlbumAdapter(p.id)?'ALBUM_CREATE_CONTRACT_UNCALIBRATED':'PLATFORM_ALBUM_ADAPTER_NOT_IMPLEMENTED'),
    albumAppend:unavailable(hasPlanAlbumAdapter(p.id)?'EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED':'PLATFORM_ALBUM_ADAPTER_NOT_IMPLEMENTED'),
    publication:{...unavailable(p.delivery==='video'?'VIDEO_PUBLISH_INTEGRATION_UNAVAILABLE':p.accountProviders.includes('tme')?'EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED':'PLATFORM_EXECUTOR_UNAVAILABLE'),queueAvailable:hasPlanAlbumAdapter(p.id)},
    // No guessed platform schema. A real adapter will return its required create fields.
    newAlbumFields:[],
  }));
  const saved = repo.maybe('settings','inbox-channel');
  return {
    routes:[
      {id:'suno_official',label:'Suno 官方（待接入）',operator:'official',executionAvailable:false,reason:'SUNO_OFFICIAL_API_UNVERIFIED',url:'https://suno.com',models:[]},
      {id:'pule',label:'谱乐 / 有乐 · 已配置服务',operator:'third_party',providerId:'yourmusic',executionAvailable:true,reason:'ADAPTER_INSTALLED_ACCOUNT_AVAILABILITY_UNKNOWN',url:'https://app.yourmusic.fun',models},
      {id:'yourmusic',label:'YourMusic 第三方 · Suno 系列',operator:'third_party',providerId:'yourmusic',executionAvailable:true,reason:'ADAPTER_INSTALLED_ACCOUNT_AVAILABILITY_UNKNOWN',url:'https://api.yourmusic.fun',models},
      {id:'manual',label:'绑定已有音频',operator:'local',executionAvailable:true,reason:'LOCAL_VERIFIED_AUDIO_BINDING',url:null,models:[]},
    ],
    profiles,
    accounts:repo.all('accounts').map(a=>({id:a.id,provider:a.provider,label:a.label ?? a.name ?? a.id,authStatus:a.authStatus,remoteSubject:a.remoteSubject ?? null})),
    platforms,
    dot:{protocolAvailable:true,requestVersion:2,triggerAvailable:false,reason:'DOT_EXTERNAL_TRIGGER_UNAVAILABLE',transport:'configured-drive-incoming-receipts',channelId:saved?.channel?.id ?? null,
      workspaceRef:saved?.channel?.workspaceRef ?? null,artistRefs:saved?.channel?.artistRefs ?? {},enabled:!!saved?.enabled},
    text:{adapter:'deepseek',dimensions:{lyrics:0.4,style:0.3,coherence:0.3},defaultThreshold:75,
      credentialVerified:false,modelCatalogSource:'saved_profile',budgetAuthorizationRequired:true},
  };
}
