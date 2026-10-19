// Capability boundary: intentionally no network client or credentials.
export const capabilities=Object.freeze({generation:{status:'simulation',providers:['Suno','谱乐 AI（真实生成未接入）'],mode:'official-generation-then-import'},cover:{status:'manual',mode:'Codex-assisted-task-then-import',apiAvailable:false},release:{status:'materials-only',audioDistribution:true,douyinVideo:true},analytics:{status:'manual-csv-import'}});
export function prepareRelease(work,artist,platform,type){return {title:work.title,artist,platform,type,lyrics:work.lyrics,license:work.license,status:'未发布；仅材料包',preparedAt:new Date().toISOString()}}

export const generationProviders=Object.freeze([{id:'suno',name:'Suno',officialUrl:'https://suno.com',status:'真实生成未接入'},{id:'yourmusic',name:'谱乐 AI',officialUrl:'https://app.yourmusic.fun/create',urlSource:'用户确认',status:'真实生成未接入'}]);
