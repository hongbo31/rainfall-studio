# 本地页面卡顿排查与修复

2026-11-27，用户反馈 `http://127.0.0.1:57647/` 的页面和功能普遍缓慢。本轮在当前源码的隔离副本和数据库副本中定位、修复并验证。

## 根因

- 静态 HTTP 首字节响应约 1 毫秒，页面资源传输不是主要瓶颈。
- Core 把界面 RPC 和后台定时检查串在同一 Promise 队列。计划检查约 5.4 秒，但计时器每秒仍追加一次检查；排队中的旧检查会挡住后续页面请求和操作。
- 对 209 条计划运行的样本，计划检查循环重复读取完整计划列表约 280 次。番茄生歌待办列表扫描配置表约 119 次。
- 浏览器界面每 1.5 秒拉取约 739 KB 的完整快照，并在内容未变化时仍更新状态，增加持续刷新和页面重绘成本。

## 修复内容

- `src/core/request-queue.ts`、`src/core/index.ts`：界面请求继续按序执行；计划检查合并为最多一个待执行/运行中的 tick，慢 tick 不再无限累积，失败后队列可继续工作。
- `src/core/api-profiles.ts`、`src/core/simple-publication.ts`、`src/core/unified-publication.ts`、`src/core/external-tme-receipt.ts`：按设置键前缀或单个 ID 查询，避免每次读取整张设置表。
- `src/core/plan-center/index.ts`、`src/core/plan-center-integration.ts`、`src/core/plan-center-music-stages.ts`、`src/core/provider-plan-text.ts`：限制到当前执行及当前条目读取，避免在每个阶段反复加载全量历史。
- `src/renderer/snapshot-refresh.ts`、`src/renderer/main.tsx`：背景快照读取合并；快照相同就不触发界面更新；页面隐藏时暂停轮询；用户操作期间若有旧快照在途，会在操作后补一次最新读取。
- 新增 `tests/core-performance.test.mjs` 和 `tests/snapshot-refresh.test.mjs` 覆盖队列合并、查询范围、刷新合并、操作后新鲜度及失败恢复。

## 性能结果

同一隔离作品库副本的前后对比：

| 操作 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 完整计划检查 | 约 5.4 秒 | 约 0.52 秒 |
| 番茄生歌待办列表 | 约 1.7 秒 | 约 0.15 秒 |
| 完整界面快照 | 约 115 毫秒 | 约 30 毫秒 |
| 计划中心列表 | 重复读取全量历史 | 单次列表约 28 毫秒 |

## 验证

- 9 项 Core 队列、查询、快照刷新及浏览器工作台测试通过。
- 计划流水线 8/8 通过。
- `node scripts/build-desktop.mjs` 隔离构建通过。Vite 显示既有的大 chunk 提示。
- 计划中心 30 项中 28 项通过；2 项失败也在修改前基线失败，失败断言与本轮变更无关。计划工作流 UI 4 项中 3 项通过，唯一失败在修改前基线也复现。AI 作词测试中的 2 项歌词格式断言同样在修改前基线失败。
- TypeScript 检查的 8 个诊断与修改前基线一致，位于 `src/main/fanqie/directory-run.ts`、`src/main/fanqie/native-upload.ts`、`src/renderer/plan-execution-labels.ts`，本轮改动文件没有新增诊断。
- 数据只从当前 browser-dev 库的只读备份复制到同级构建目录后测试，未写真实作品库。

## 未验证与交付边界

- 57647 端口在排查后已无监听进程；也未发现 59649 监听。构建后未重启或打开客户端，因此本轮没有对运行中的页面做原生验收，已运行的浏览器入口也未切换到新源码。
- 未操作真实账号、生成或发布歌曲，未更新桌面快捷方式或正式运行指针。

## 回退

本工作树包含其他并行改动，相关源文件也可能被其他任务修改。回退时只撤销本交接列出的队列、按键查询和刷新合并代码段；不要对这些共享文件整体执行 `git restore`。测试文件及本交接可单独移除。回退后重新运行隔离构建和对应测试。
