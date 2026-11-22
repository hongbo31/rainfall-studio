# 任务中心与计划中心并行执行

2026-11-22

## 原因与修复

任务中心引用计划后，原先按计划 ID 检查所有未结束的执行。计划中心的「立刻执行」因此返回 `ACTIVE_RUN`。反过来，任务中心也会因计划中心已有执行而等待或跳过该次调度。

两个中心现在按执行来源检查占用。同一计划可以从两个中心各启动一次，每次保存自己的执行 ID、配置快照、阶段记录和结果。查看和停止都按所属执行操作。同一中心的防重仍生效，任务中心引用同一计划的多个任务沿用原有排队规则。

谱乐 AI 和苏诺之音按执行 ID 分配独立的浏览器页面。同账号的两次执行都能打开并准备表单。生成提交到识别回执的环节按账号排队，避免将一首歌记到另一次执行中。番茄上传继续按账号认领文件并核对投稿回执，避免重复投稿同一首歌。

## 涉及文件

- `src/core/plan-center/index.ts` 与 `src/core/publication-task-integration.ts` 按执行来源判断手动启动和定时调度的占用。
- `src/core/plan-pule.ts`、`src/main/plan-pule.ts`、`src/main/bootstrap.ts` 将浏览器音乐执行接入按执行 ID 管理的页面及同账号回执检查。
- `tests/publication-tasks.test.mjs`、`tests/plan-center.test.mjs`、`tests/plan-workflow-refactor.test.mjs`、`tests/plan-workflow-ui.test.mjs` 覆盖两个启动顺序、定时执行、停止、列表和详情、同账号音乐页面及回执归属。

## 验证与交付

测试与日志位于源码同级的 `rainfall-studio-build/plan-task-parallel-5456e593`。

| 范围 | 结果 |
| --- | --- |
| 计划、任务、作词和归档 | 127 项通过，两边可以各自执行、查看和停止 |
| 计划中心、番茄计划和旧计划集成 | 29、18、8 项通过，覆盖定时执行和投稿回执防重 |
| 浏览器版 | 4 项无头界面及桥接测试通过，含任务执行中点击「立刻执行」 |
| 谱乐 AI 和苏诺之音 | 87 项中初跑通过 82 项。其余 5 项使用 Windows 默认临时目录时遇到短文件名与实际路径不一致。切换到构建目录的临时路径后，失败项和两个账号窗口隔离用例共 7 项复测通过 |
| Windows 客户端 | TypeScript、Main、preload、Core 和渲染构建通过。随包 Electron 的 Node 模式定向复测 4 项通过 |

真实账号生成、投稿和 Windows 原生窗口待验收。本轮使用隔离测试数据。桌面交付依 `docs/release/desktop-delivery-policy.md` 在可验证的正式数据根和原生验收就绪后更新入口。浏览器版沿用 `Start-Rainfall-Browser.bat` 启动并构建源码。

## 回退

撤回上列文件中的本轮差异，使用原入口重新构建。数据格式沿用现有版本，执行记录和回执按原执行 ID 保存，无需迁移。
