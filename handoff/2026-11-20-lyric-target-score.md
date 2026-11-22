# AI 作词目标评分与最高分稿

2026-11-20

## 使用与改动

- 「AI作词 → 按艺人信息」选中带歌词的艺人后，填「目标评分」。计划中心的 AI 作词及文本节点也可设置。默认 90 分，可填 0 到 100 的整数。计划保存所选分数，执行快照保留当次配置。纯音乐和单独生成灵感的页面隐藏这个字段。
- 作词评分达到目标且语种符合要求时结束。改写次数用完后，采用初稿和改写稿中得分最高的已评审稿。并列时优先选择符合语种要求的稿，再选较新的一稿。模型返回已有歌词时计一次改写，复用该稿评分。
- 每轮改写的输入、当前稿的显示和 TXT 保存路径见 [统一下载目录与逐轮优化歌词](2026-11-20-download-directory-and-lyric-iterations.md)。
- 结果页面标记实际得分与目标分。查看、复制、TXT 导出、快速生成和计划下游使用同一稿件。实际分数由模型返回，语种状态单独显示。
- 旧版已经停在低分的计划，在「查看作词评分」旁可点「采用最高分稿并继续（按服务计费）」。使用原执行项已保存的评审稿，后续音乐生成按平台计费。旧记录和原始评分保留。

## 涉及文件

- `src/shared/lyric-writing.ts`、`src/shared/plan-center.ts` 定义目标评分和结果稿件 ID。新执行中缺省目标按 90 分计算。较早执行中缺少目标字段的历史作词记录仍可读取。
- `src/core/lyric-writing.ts` 和 `src/core/plan-workflow.ts` 处理改写上限、确定结果稿、校验历史恢复和传递作品。新的结果稿件 ID 与原评分版本绑定，保留各版歌词和意见。
- `src/renderer/pages/LyricWriting.tsx`、`src/renderer/components/PlanWorkflowForm.tsx`、`src/renderer/components/PlanLyricReview.tsx` 和 `src/renderer/pages/PlanCenter.tsx` 共享配置、诊断和结果展示。
- 回归覆盖在 `tests/lyric-writing.test.mjs`、`tests/lyric-writing-ui.test.mjs`、`tests/plan-workflow-refactor.test.mjs` 和 `tests/plan-workflow-ui.test.mjs`。

## 验证与回退

- 共 76 项定向自动测试通过，覆盖配置范围、默认值、达到目标、达到改写上限、重复稿、历史恢复、下游传递及浏览器工作台。计划中心 SQLite 测试的相对输出位于隔离构建目录。
- 通过 TypeScript 检查及 `Start-Rainfall-Browser.bat -BuildOnly`。浏览器使用无头 Chromium 验证。Windows 客户端完成 Main、预加载、Core 和共用渲染层构建。原生窗口和真实服务执行待验收。
- 用「测试」计划的实际失败任务只读副本加载构建后的界面。隔离恢复选中 78 分稿，继续到音乐提交阶段。验证过程没有调用计费接口，也没有改写正式库。
- 浏览器沿用原启动 BAT。SQLite 表结构沿用现有版本。旧构建的计划读取规则早于 `targetScore` 字段，回退时用升级前的库备份做隔离验证，按桌面交付策略切换入口。
