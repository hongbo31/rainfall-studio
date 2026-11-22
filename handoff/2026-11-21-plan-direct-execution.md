# 计划中心一键执行与番茄账号

2026-11-21

番茄音乐节点只需选择账号管理中已配置的发布账号，计划编辑器移除了「核对番茄账号」按钮。之前，计划预览要求节点保存手动核对生成的账号和配置指纹，导致仅保存发布账号的计划无法开始。

点击「立刻执行」后，计划中心按当前保存的版本直接发起执行，并显示当次执行详情。发起请求保留版本校验和同一请求的去重。已有执行、结果未知的回执和付费步骤的重试沿用原有处理。

- 只有番茄节点的计划从所选账号的下载目录取歌，提交前自动核验浏览器登录身份与上传配置。执行日志记录所用的账号，已有回执参与对账。
- 上游创作结束且材料齐备后，番茄发布节点从对应账号会话读取身份和上传配置，再创建经过去重的发布队列。解析身份时读取账号资料，不翻页扫描作品。账号失效或授权缺失在执行详情显示原因。重新登录后，尚未创建发布队列的执行可继续。
- 保留已保存的账号指纹、每批上限、签约选项和历史执行记录。合同最终确认依旧由本人完成。

## 涉及文件

- `src/renderer/pages/PlanCenter.tsx`、`src/renderer/components/PlanWorkflowForm.tsx` 更新计划执行入口和账号表单。浏览器与 Windows 客户端共用界面。
- `src/core/plan-workflow.ts`、`src/core/plan-workflow-publication.ts`、`src/core/plan-fanqie.ts`、`src/shared/plan-workflow-publication.ts` 更新计划校验，记录发布节点的账号解析结果并限制其作用域。
- `src/main/bootstrap.ts`、`src/main/fanqie/upload-broker.ts`、`src/main/fanqie/plan-publisher.ts`、`src/main/fanqie/plan-directory-publisher.ts`、`src/main/fanqie/directory-run.ts` 接上所选账号的会话和上传队列。
- `tests/plan-workflow-ui.test.mjs`、`tests/plan-workflow-refactor.test.mjs`、`tests/fanqie-downloads.test.mjs`、`scripts/test-plan-center-headless.mjs` 覆盖新入口、仅保存账号的旧计划和执行详情。

## 验证与回退

- 在源码同级构建目录的 `verification/plan-run-direct-4b59f173` 使用隔离库、无头 Chromium 和模拟回执。104 项相关回归通过，最终聚焦复测 59 项通过，另有 18 项计划番茄测试和 8 项统一计划集成测试通过。计划编辑器与真实 SQLite Core 的无头检查覆盖并发编辑拒绝过期执行和一次点击写入执行记录。
- TypeScript 检查和 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过，核对了浏览器构建快照的源码哈希及 Windows 共用 Main、预加载、Core 和渲染层产物。实际番茄账号投稿、签署和 Windows 原生窗口待验收。
- 正式库与桌面入口沿用现有交付指针。设置和执行记录沿用现有表结构。需要回退时可在隔离库验证最近的已验收版本和备份，再按桌面交付策略恢复。
