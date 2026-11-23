# 苏诺之音 WAV 下载重试与艺人资料同步

2026-11-23，北京时间。backend 负责苏诺网页下载，xb 负责计划与任务的 Core 数据，frontend 负责界面同步和编辑草稿，qa 负责 Core 回归。

## RF-009 · 苏诺之音原 WAV 下载菜单

旧流程已经识别原曲并写入本次生成回执。打开 WAV 子菜单失败时会直接报 `SUNO_CN_WAV_MENU_UNAVAILABLE`。新流程在同一账号页面重开已核对的原歌曲菜单。每版原曲在首次尝试后最多再试 3 次，菜单缺失、可恢复的 WAV 转换超时和下载未开始共用这一上限。转换超时及下载未开始仍分别执行自己的原有重试限制。

重试核对歌曲仍是当前创作列表中的原始结果，确认下载前再次核对。A、B 独立，已保存的音频和原回执继续使用。到达上限时保留当次错误，取消或结果行失效时停止等待。[下载执行器](../src/main/suno-cn-browser-page.ts#L235) · [苏诺回归](../tests/suno-cn-browser.test.mjs#L143) · [模拟页面](../tests/fixtures/suno-cn-browser.html)

## RF-010 · 艺人资料同步

- 原计划定义中保存了艺人修订版。账号管理保存新版后，计划读取的是旧快照，新启动的工作流会因版本差异停止。计划列表、详情、确认预览及任务选择器现在按已绑定的艺人 ID 获取最新资料。人声、音色权重、词曲署名、A/B 歌手、关联模板及封面默认值随资料更新。艺人 ID 和计划关联账号继续校验。[资料读取](../src/core/plan-workflow.ts#L44) · [计划列表](../src/core/plan-center-reads.ts) · [计划读取入口](../src/core/plan-center-integration.ts) · [任务计划选项](../src/core/publication-task-integration.ts)
- 手动、定时和任务队列中的计划都在真正开始时固定本次资料。活动执行和历史沿用各自的快照，后续作词也使用该执行里的艺人设置。旧确认摘要会在艺人资料变化后失效。自动同步通过读取完成，已有计划和任务的定义、修订号及调度时间沿用原记录。[计划执行](../src/core/plan-center/index.ts) · [艺人快照](../src/core/generation-config.ts) · [作词执行](../src/core/lyric-writing.ts#L247)
- 新执行按艺人的当前创作类型适配歌词输入。纯音乐时跳过歌词输入，转为带歌词且缺省时使用作词阶段的歌词字段。原定义中的自定义映射继续保留，转回带歌词时重新使用。已经打开的计划详情和任务选择器沿用两中心的自动刷新。编辑表单会保留草稿，关联账号发生变化时要求显式重新选择。[输入映射](../src/shared/plan-workflow-fields.ts) · [表单](../src/renderer/components/PlanWorkflowForm.tsx) · [计划详情](../src/renderer/pages/PlanCenter.tsx) · [Core 回归](../tests/plan-workflow-refactor.test.mjs#L105) · [界面回归](../tests/plan-workflow-ui.test.mjs)

## 验证与交付

- 旧版模拟复现了菜单失败后提前退出、艺人变更后使用旧资料，以及纯音乐与带歌词切换后的输入缺失。Windows 随包 Electron Node 模式通过 27 项苏诺之音网页回归，覆盖 B 版在第三次重试时恢复、持续缺失时共尝试 4 次、混合错误共用上限、保留已下载的 A 版，以及拒绝用同名的其他歌曲替代。共用谱乐网页路径回归 67 项通过。
- Core 工作流、作词、任务和提示词回归 144 项通过，计划中心 30 项、完整计划流水线 8 项、Windows Electron Node 模式生成路由 9 项通过。覆盖旧计划、新旧确认摘要、定时、同账号排队、在途作词、跨账号及两种创作类型。两中心和平台管理无头回归 6 项通过。
- TypeScript 和原浏览器入口的 `-BuildOnly` 通过，生成 Windows 与浏览器共用的 Main、preload、Core 及 renderer。证据在仓库同级目录 `../rainfall-studio-build/verification/rf009-rf010-6ae8453e`。独立红绿灯报告在同级 `rf009-backend-b913ed29`、`rf010-qa-0ffb9ac6` 与 `rf010-frontend-d2367baa`。

正式账号的苏诺网页下载和 Windows 原生窗口待验收。浏览器下次通过原 `Start-Rainfall-Browser.bat` 启动时加载本轮源码。需要回退时，从上文文件中撤回 RF-009 和 RF-010 的对应差异，再用原入口构建。可保留作品、计划历史、WAV 和生成回执。
