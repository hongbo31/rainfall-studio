# 计划中心平台工作流

2026-11-20

## 改动与影响

- 新建和编辑计划使用同一流程画布。可拖入节点、移动节点、从输出端连到下一个输入端，也可用键盘操作。保存后还原节点位置和连线。支持 AI作词或指定文本服务起步，接入创作中心或歌曲生成平台，再按需连接多个发布平台。
- 计划编辑器与平台管理共用平台目录。目录随应用快照刷新，新增已接入的渠道会进入画布。模型选项按节点提供商筛选。发布节点默认读取平台管理的发布账号，计划可另选并保存账号。网易云音乐和抖音视频目前缺少发布执行器，在目录中显示为不可用。
- 出现发布节点时，计划需要完整封面和发布授权。所有歌曲归档后才登记发布队列。番茄音乐和腾讯音乐沿用各自的队列及收件核对。汽水音乐从计划详情加载指定作品、录音版本和发布账号。用户确认合同并在官网完成验证码后，回到计划登记提交。停止操作会阻止后续派发，已取得的回执继续保留。
- 原有「AI作词 → 创作中心」计划及历史执行可在新版读取。新版增加的节点类型和发布绑定随计划快照保存。浏览器版与 Windows 客户端共用渲染界面、计划模型和执行逻辑。

## 涉及文件

- 平台及配置目录在 `src/shared/platform-directory.ts`、`src/shared/platform-config.ts`、`src/shared/api-profiles.ts`、`src/core/generation-config.ts`、`src/core/studio.ts` 和 `src/renderer/pages/PlatformManagement.tsx`。
- 画布、计划编辑与执行详情在 `src/shared/plan-workflow-graph.ts`、`src/shared/plan-center.ts`、`src/renderer/components/PlanWorkflowCanvas.tsx`、`src/renderer/components/PlanWorkflowForm.tsx`、`src/renderer/pages/PlanCenter.tsx` 和相应 CSS。
- 计划调度与发布队列在 `src/core/plan-workflow.ts`、`src/core/plan-center/`、`src/core/plan-center-integration.ts`、`src/core/plan-workflow-publication.ts`、`src/core/publication-queue.ts`、`src/core/publication-task-integration.ts`、`src/core/publication-tasks.ts`、`src/core/plan-fanqie.ts`、`src/core/fanqie-work.ts` 和 `src/main/fanqie/upload-broker.ts`。
- 汽水音乐计划范围和确认复用 `src/renderer/components/QishuiPublisher.tsx`、`src/core/qishui-work.ts`、`src/main/qishui-flow.ts` 与两端共用的 RPC。计划范围的协议定义在 `src/shared/plan-workflow-publication.ts`、`src/shared/qishui.ts`、`src/shared/schemas.ts`。接线位于 `src/main/bootstrap.ts`、`src/core/index.ts`。

## 验证

- 用同一个 `Start-Rainfall-Browser.bat -BuildOnly` 在同级构建目录完成 Main、preload、Core 及渲染层构建。TypeScript 检查通过。
- 通过真实本地浏览器服务及隔离 SQLite 库，在无头 Chromium 中保存并重开「AI作词 → 谱乐 AI → 汽水音乐」「DeepSeek → 谱乐 AI → 番茄音乐」「AI作词 → 谱乐 AI」。核对目录默认账号、拖动位置、连线、实际模型快照和番茄账号核对门槛。
- 定向回归 38 项通过，另通过计划基础、素材、目录、模型及发布回归 90 项和番茄回归 103 项。夹具覆盖编辑期间更新节点目录、精确录音版本、整批归档、收件状态、停止及防止重复派发。修正番茄旧夹具以提供当前工作解析依赖。
- Windows 原生窗口、正式桌面包、真实账号付费生成、平台收件及签约仍待验收。这轮验收使用后台隔离工作区。

## 启动与回退

使用原来的 `Start-Rainfall-Browser.bat`，进入「计划中心 → 新建计划」或打开已有计划编辑。需要回退时先暂停相关计划、备份数据库和作品文件。旧版只能识别旧式图，应使用升级前的备份做回退演练，并保留新版任务和发布回执，避免旧版读取新版节点或重发已交审作品。正式桌面入口切换按 `docs/release/desktop-delivery-policy.md` 执行。
