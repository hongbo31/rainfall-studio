import type { Repository } from './database';

// Describes installed code and saved declarations, never a live provider discovery result.
// Native providers must supply a fresh trusted catalog before an album/model is executable.
export function planCatalog(repo: Repository) {
  const profiles = repo.all('settings').filter(r => r.id.startsWith('api-profile:')).map(p => ({
    id:p.id.slice('api-profile:'.length), label:p.label, kind:p.kind,
    providerId:p.providerId, modelId:p.modelId, revision:p.revision,
  }));
  const declaredModels = profiles.filter(p => p.providerId === 'yourmusic' && p.modelId).map(p => ({
    id:p.modelId, profileId:p.id, label:p.modelId,
    verified:false, evidence:'saved_profile', executionAvailable:false,
  }));
  const unavailable = (reason:string) => ({available:false,reason});
  const platforms = [
    {id:'netease',label:'网易云音乐',delivery:'audio',accountProviders:['netease']},
    {id:'qishui',label:'汽水音乐',delivery:'audio',accountProviders:['qishui']},
    {id:'qqmusic',label:'QQ 音乐',delivery:'audio',accountProviders:['qqmusic','tme']},
    {id:'kugou',label:'酷狗音乐',delivery:'audio',accountProviders:['kugou','tme']},
    {id:'douyin',label:'抖音',delivery:'video',accountProviders:['douyin']},
  ].map(p => ({...p,
    catalog:{...unavailable('ALBUM_CATALOG_INTEGRATION_UNAVAILABLE'),albums:[],source:'unavailable'},
    albumCreate:unavailable('ALBUM_CREATE_INTEGRATION_UNAVAILABLE'),
    albumAppend:unavailable('ALBUM_APPEND_INTEGRATION_UNVERIFIED'),
    publication:unavailable(p.delivery==='video'?'VIDEO_PUBLISH_INTEGRATION_UNAVAILABLE':'PUBLICATION_EXECUTOR_UNAVAILABLE'),
    // No guessed platform schema. A real adapter will return its required create fields.
    newAlbumFields:[],
  }));
  const saved = repo.maybe('settings','inbox-channel');
  return {
    routes:[
      {id:'suno_official',label:'Suno 官方（待接入）',operator:'official',executionAvailable:false,reason:'SUNO_OFFICIAL_API_UNVERIFIED',url:'https://suno.com',models:[]},
      {id:'pule',label:'谱乐 AI（网址待提供）',operator:'unverified',executionAvailable:false,reason:'PULE_URL_REQUIRED',url:null,models:[]},
      {id:'yourmusic',label:'YourMusic 第三方 · Suno 系列',operator:'third_party',executionAvailable:false,reason:'LIVE_MODEL_CATALOG_REQUIRED',url:'https://api.yourmusic.fun',models:declaredModels},
      {id:'manual',label:'手动导入（计划关联待接入）',operator:'local',executionAvailable:false,reason:'MANUAL_MUSIC_IMPORT_INTEGRATION_UNAVAILABLE',url:null,models:[]},
    ],
    profiles,
    accounts:repo.all('accounts').map(a=>({id:a.id,provider:a.provider,label:a.label ?? a.name ?? a.id,authStatus:a.authStatus,remoteSubject:a.remoteSubject ?? null})),
    platforms,
    dot:{triggerAvailable:false,reason:'DOT_EXTERNAL_TRIGGER_UNAVAILABLE',transport:'configured-drive-incoming-receipts',channelId:saved?.channel?.id ?? null,
      workspaceRef:saved?.channel?.workspaceRef ?? null,artistRefs:saved?.channel?.artistRefs ?? {},enabled:!!saved?.enabled},
    text:{adapter:'deepseek',dimensions:{lyrics:0.4,style:0.3,coherence:0.3},defaultThreshold:75,
      credentialVerified:false,modelCatalogSource:'saved_profile',budgetAuthorizationRequired:true},
  };
}
