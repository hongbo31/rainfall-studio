import type { LyricJob } from "../shared/lyric-writing";

export const currentLyricCraftVersion = 1;
type CraftJob = Pick<LyricJob, "kind" | "songType" | "phase"> & { lyricCraftVersion?: 1 };

// Persisted jobs keep their version. Add a new version rather than changing v1 for in-flight jobs.
const craftV1 = {
  shared: [
    "歌词创作准则 v1：依据本首内容、曲风、用途、语种和人物语体判断，不套固定模板。",
    "以下只是可择用的曲风倾向，混合风格按创作要求取舍：流行/抒情重易懂核心句和情绪层次；民谣/乡村重生活细节；DJ/舞曲可用短句、呼应、重复和留白，也可以有完整唱段；说唱重语流、节奏组织、自然内韵与内容推进，不默认炫耀；摇滚重清楚立场和有力度的可唱语句，不默认愤怒；国风重语境与意象一致，不等于必须戏腔、七言或堆古词；R&B/爵士重措辞弹性与气口；助眠人声允许低起伏和有意循环，不强加剧情冲突。",
    "语种独立于曲风；按指定语言的词义、语序、语体、重音/声调与韵处理。粤语是语种，不按助词数量衡量自然度，合适的书面粤语也可自然，不能机械替换普通话词汇。无旋律时只能判断文本节奏风险，不能保证协音或词曲配合。",
  ].join(""),
  generate: [
    "动笔前在内部明确谁对谁说、具体处境与核心情绪；用动作、物件、对话或感官细节承载内容，避免空泛套话，也保留直白表达，不要求每句都堆意象。",
    "让段落各有作用：可以推进事件、态度、视角或意象，也可以有目的地循环；非重复段落不要只换词复述。安排可辨识的核心句、节奏或意象作为记忆点，不强制副歌。",
    "句长、语义分组、自然语音重音、换气、韵脚与密度共同服务情绪；不以固定字数代替可唱性，不为押韵扭曲语序或强行同韵。完成后内部通读弱句、段落联系与语言自然度再输出。",
    "乐器、音色和编曲说明写入 style 或简短独立制作标注，不挤占可唱正文；不把标题中的营销后缀强塞进歌词。维持要求的 JSON 字段，不输出内部构思过程。",
  ].join(""),
  score: [
    "五项沿用原字段、分值与输出格式，具体按以下含义独立判断：styleFit 看表达、密度与结构是否服务创作要求；narrative 看人物、事件、情绪或意象是否连贯，发展或有意循环是否有作用，不要求必须讲故事；naturalness 看词义、语序是否符合语种及角色语体；singability 看语义分组、自然重音、气口与文本节奏风险，不用整齐字数替代判断；hook 指全曲记忆点，可以是核心句、节奏或意象，不必是副歌，不因缺少副歌自动扣分。",
    "findings 对主要问题写清当前稿的具体原句、问题、对本曲风或表达的影响、优先修订方向；有问题时不只写“感染力不足”等空泛结论。同时引用值得保留的词句并说明亮点；没有明确问题时给出具体优点依据，不为凑数挑错。区分必须修复与可选润色。",
    "有效重复、温和情绪、稀疏措辞、不押韵本身不是缺点；只根据实际作用评价。不能给未听到的旋律、演唱或乐器表现打分，不用个人偏好替换创作要求。",
  ].join(""),
  rewrite: [
    "先按反馈区分关键问题与可选润色，从最影响本首表达或可唱性的关键问题和弱句开始修改；保留已成立的核心句、细节、段落及有效重复，不机械重写整首，不用无关新意象换掉原歌。",
    "修改后在内部逐项复核原问题是否解决、段落是否连贯、语义重音与气口是否自然、语种与曲风是否仍符合要求；避免为提分制造无必要改动。按原格式返回完整歌词，creativeSummary 简述实际修改，不输出内部检查过程。",
  ].join(""),
};

export function lyricCraftGuidance(job: CraftJob, phase = job.phase): string {
  if (job.lyricCraftVersion !== 1 || job.kind === "inspiration" || job.songType !== "vocal" || phase === "prompt") return "";
  return craftV1.shared + craftV1[phase];
}

export function lyricCraftInputBytes(job: CraftJob, phase: "score" | "rewrite"): number {
  // This is appended to an existing system string: count escaped UTF-8 content, not another pair of quotes.
  return Buffer.byteLength(JSON.stringify(lyricCraftGuidance(job, phase)), "utf8") - 2;
}
