export const platforms=['网易云音乐','汽水音乐','QQ 音乐','酷狗音乐','抖音'];
export const seed=()=>({schema:1,artist:'雨间',budget:100,works:['那天刚好下雨','顺路','从今天起'].map((title,i)=>({id:'rain-'+i,title,story:['雨天在屋檐下相识，共用一把伞。','从偶遇变成每天一起回家的顺路。','在熟悉的路口，终于把心意说出口。'][i],phase:['相识','熟悉','告白'][i],style:'独立流行',language:'中文',voice:'女声',mood:'温柔',tempo:'中速',duration:'3 分钟',lyrics:'[主歌]\n雨落在没说完的话里\n你把半边晴天留给我\n[副歌]\n那条路绕过所有犹豫\n刚好走到你的心里',versions:[],cover:null,coverTone:i,license:'原创示例文本；无音频。真实生成结果须另行核验授权。',review:'材料草稿'})),tasks:[],reports:[],accounts:[]});
export function enqueue(state,work,provider){const key=JSON.stringify([work.id,provider,work.lyrics,work.style,work.voice,work.language,work.mood,work.tempo,work.duration,work.prompt]);if(state.tasks.some(t=>t.key===key&&t.status!=='已取消'))return false;state.tasks.push({id:crypto.randomUUID(),key,title:work.title,provider,status:'模拟排队',cost:0});return true}
export function validateBackup(s){return s&&s.schema===1&&Array.isArray(s.works)&&s.works.length>0&&s.works.every(w=>typeof w.id==='string'&&typeof w.title==='string'&&typeof w.lyrics==='string'&&Array.isArray(w.versions))&&Array.isArray(s.tasks)&&Array.isArray(s.reports)&&Array.isArray(s.accounts)&&Number.isFinite(s.budget)}
export function promptFor(w){return `${w.style}，${w.language}，${w.voice}，${w.mood}，${w.tempo}，${w.duration}。故事：${w.story}。原创旋律，保留自然呼吸与情绪层次。`}


