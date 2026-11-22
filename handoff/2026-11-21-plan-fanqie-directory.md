# 番茄音乐独立目录发布计划

2026-11-21

## 使用方式

画布原先只接受从作词到生成再到发布的连线，番茄节点单独放置时保存按钮会被禁用。现在可以新建计划，只添加「番茄音乐」，选择并核对发布账号，填写每批上传上限和签约选项后保存。计划中心的「立刻执行」使用发布确认。发布中心也可以关联此计划。

## 执行步骤

1. 读取本次执行快照中的发布账号和分批设置。用配置中心的下载目录扫描该账号的歌手文件夹，按同名匹配音频、歌词、封面和适用的版权证明。
2. 目录没有可上传的歌曲时，本次计划记为「已停止」。关联此计划的发布任务按顺序执行下一项。
3. 发现可上传的歌曲时，复用番茄账号的目录上传流程。每批先核对账号及官网重复作品，再以当前文件和本次计划的执行状态检查确认上传。执行日志和回执以执行 ID 存在该账号的 `download-runs/<执行 ID>/` 中，下载原件保留在本地。
4. 根据本批回执和节点设置继续。节点选「否」时，核对到待签合同即可继续。发布中心任务选「否」时跳过合同准备。需要签署时由本人在官网确认。需要查对的执行在计划详情里提供「核对番茄回执并继续」，沿原执行 ID 核对或恢复。
5. 已连线的生成发布计划沿原作品流程执行。目录计划设置及回执独立于平台管理的手动目录上传批次。

## 代码及影响

- `src/shared/plan-workflow-graph.ts` 和 `src/shared/plan-center.ts` 接受独立番茄节点和无生成配置的计划。 `src/renderer/components/PlanWorkflowForm.tsx`、`PlanWorkflowCanvas.tsx` 和 `src/renderer/pages/PlanCenter.tsx` 展示账号、目录来源、执行确认和结果。
- `src/core/plan-center/index.ts`、`plan-center-integration.ts`、`plan-workflow.ts` 和 `plan-workflow-publication.ts` 分别处理保存、授权和原生成发布队列。 `src/core/publication-task-integration.ts` 将独立计划加入发布中心并识别目录为空的结束状态。
- `src/core/plan-fanqie-directory.ts`、`src/core/index.ts` 和 `src/shared/schemas.ts` 处理执行范围、状态和回执核对入口。 `src/main/fanqie/plan-directory-publisher.ts`、`directory-run.ts`、`upload-broker.ts` 和 `src/main/bootstrap.ts` 负责按账号扫描、上传和恢复。

## 验证与回退

- `tests/plan-workflow-ui.test.mjs` 复现旧版保存按钮禁用，验证独立节点配置、保存、执行确认及空目录结果。 `tests/fanqie-downloads.test.mjs` 使用隔离目录和模拟番茄回执核对账号筛选、分批、发布任务续跑、重启去重及停止请求。
- 在 `rainfall-studio-build/plan-local-fanqie-20261121` 隔离通过 76 项相关测试及 `scripts/test-plan-fanqie.mjs` 的 18 项回归。无头浏览器覆盖共用界面和桥接。TypeScript 检查以及 Windows Main、预加载、Core 和渲染层构建通过。
- Windows 原生窗口、真实账号上传和签署待验收。
- 回退前备份计划库和账号上传日志。旧版读取本次新增的独立计划结构前，使用回退数据副本恢复旧版可读的计划记录。正式作品、下载原件及官网回执用于后续核对。
