# 按曲风提升 AI 作词能力 Implementation Plan

**Goal:** 在 AI 作词既有生成、评分和改写中加入可执行的曲风与写作标准。

**Architecture:** 新增独立的版本化歌词指导模块；LyricWritingService 在新建人声任务估价前存内部版本并只在三个歌词阶段应用。旧任务与沿用原稿重试保持来源版本，新增提示开销进入原估价与后续预留。

**Tech Stack:** TypeScript、现有 SQLite Repository、Node mock tests、esbuild 内存编译。

**Spec:** `docs/superpowers/specs/2026-11-28-genre-lyric-craft-design.md`

## 文件与归属

- fullstack：`src/core/lyric-craft.ts`（新规则）、`src/core/lyric-writing.ts`（版本接入和预留）、`tests/lyric-craft.test.mjs`（新增定向回归）；必要时最小调整 `tests/lyric-writing.test.mjs` 中受提示开销变化影响的预算样例。保留这些文件里的既有标题改动。
- xb：本设计/计划、`handoff/2026-11-28-genre-lyric-craft.md`、`docs/project/board.md`。
- 研究与审查同学只读，不修改共享文件。禁止触碰并行的 Pule 修复。

## 实施

- [x] 新人声任务在估价前持久化内部规则版本，visible 剔除；retrySource 无条件继承来源版本，包括 undefined。
- [x] 生成指导含主题/视角/具体表达、段落作用、核心记忆点、曲风倾向、语种/方言、语音节奏和简短制作标注边界。
- [x] 评审给出具体词句/问题/影响/修改方向，保留五项字段；不强制故事、副歌、同韵或高密度，不对未听音频打分。
- [x] 改写按当前评语优先修关键问题并复核，保留亮点和风格；不增加模型阶段或改写上限。
- [x] 对新版本将评分/改写新增 system 文本实际 JSON 编码字节开销计入后续预留，保持旧版估价公式。
- [x] 用现有内存 mock 测试覆盖人声阶段、旧任务、继承式重试、纯音乐/灵感排除、版本隐藏及估价兼容。测试使用源码同级隔离目录。
- [x] 独立静态审查与针对性回归，更新交接和台账。未调用真实模型、未试听，艺术质量未验收。16 项新测试通过；原套件 3 项失败已在本轮前基线复现，全仓类型检查另有 12 条诊断，完整证据见[交接](../../../handoff/2026-11-28-genre-lyric-craft.md)。

## 回退

关闭新版本分配并保留旧版本函数供已有任务恢复；或在没有该版本在途任务时回退本轮改动。不得清理旧作品或用不确定回执重发收费生成。当前功能分支已有未提交标题/Pule改动，不使用整文件 git restore，不自动提交/推送/打包。
