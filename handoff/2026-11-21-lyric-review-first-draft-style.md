# AI 作词按首稿风格评审

2026-11-21

初稿和改写稿此前由模型逐轮独立给出总分。独立 AI 作词的评审也缺少原始创作要求，降分稿会继续作为下一轮底稿。新增带歌词的作词任务使用资深作词人评审，以同一首歌首次生成的风格描述为各轮基准，并带上保存的艺人设定、提示词或创作灵感。

- `src/core/lyric-writing.ts` 要求评审引用具体词句，指出优先修改的问题和应保留的亮点。风格贴合、叙事与情绪、语言自然度、文本可唱性和副歌记忆点各为 20 分，程序加总。对只返回总分的有效结果保留兼容。改写优先从符合语种要求的高分已评稿继续，落选稿的反馈供下一轮参考。
- `src/shared/lyric-writing.ts` 定义可选分项和评分范围。`src/renderer/components/LyricReviewNotes.tsx` 在 `src/renderer/pages/LyricWriting.tsx` 和 `src/renderer/components/PlanLyricReview.tsx` 的评分详情显示分项与评语。已有记录仍能查看。
- 运行中的历史任务和从旧稿续跑的任务沿用其评审方式。纯音乐及只生成灵感的任务沿用各自流程。作词仍使用已配置的文本模型和每轮评审调用，预算估算计入新请求带上的上下文。

## 验证与回退

- `tests/lyric-writing.test.mjs` 和 `tests/plan-workflow-refactor.test.mjs` 覆盖首稿风格固定、分项加总、降分后的底稿选择和历史任务恢复。`tests/lyric-writing-ui.test.mjs` 和 `tests/plan-workflow-ui.test.mjs` 验证两处展开评分详情、历史得分和结果选稿。
- 61 项回归测试通过。TypeScript 检查及 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过。浏览器和 Windows 共享 Core 与渲染组件。Chromium 无头测试验证界面，Windows 原生窗口和真实模型的评审效果待验收。桌面入口未更新。
- 若需回退，撤销本次评审流程、分项展示和回归断言后重建。现有总分和评语字段继续使用原格式，分项为可选数据。
