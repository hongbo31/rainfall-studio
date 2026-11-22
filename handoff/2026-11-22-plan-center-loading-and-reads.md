# 计划中心加载反馈与读取优化

2026-11-22

计划中心进入列表时显示加载图标，失败时可重试。点击编辑时会在该行显示读取进度，新增和编辑共用保存入口，保存期间显示进度并禁止重复提交。写入成功后刷新计划列表和状态。任务中心的列表、关联计划和执行记录也使用同一套加载图标。

## 读取链路

- 计划列表原先同时读取完整执行记录、素材目录、配置和执行状态。每次读取还会刷新全库快照。现在首屏只请求计划列表摘要。点击详情时读取该计划的历史，点开执行记录时读取对应阶段、发布回执和素材状态。仅手动绑定音频的流程需要检查该艺人的候选作品。
- 两个中心共用轮询逻辑。收到响应后再安排下一次读取，切换计划或关联任务时丢弃旧请求的响应。只刷新相关列表或记录，避免读操作连带刷新整个作品库。
- 计划和任务查询通过 SQLite 的记录前缀缩小读取范围。展开任务时按关联执行 ID 查询条目和阶段。计划列表的删除状态与实际删除使用同一条规则，继续识别待核对回执及任务中心拥有的执行。

## 涉及文件

- `src/renderer/use-center-query.ts` 和 `src/renderer/use-plan-center-data.ts` 负责轮询与计划数据读取。`PlanCenter.tsx`、`PublishCenter.tsx` 和各自的编辑器消费这些数据及加载状态。`LoadingIndicator.tsx` 和 `loading-indicator.css` 提供两个主题共用的加载图标，并支持减少动态效果偏好。
- `src/renderer/context.tsx`、`main.tsx` 和 `pages/BrowserPublishWorkbench.tsx` 支持页面请求后按需刷新全库。`PlanWorkflowForm.tsx` 优先复用已加载的配置，`PlanAlbumOperations.tsx`、`PlanLyricReview.tsx` 和 `PlanRunAssets.tsx` 刷新各自相关数据。
- `src/core/plan-center-reads.ts` 集中处理列表、历史及执行详情的查询。`plan-center-integration.ts` 与 `src/shared/{plan-center,schemas}.ts` 定义对应接口。原查询接口仍可供其他调用方读取完整数据。
- `src/core/database.ts`、`plan-center/storage.ts`、`publication-tasks.ts` 和 `publication-task-integration.ts` 按记录前缀及执行范围查询。素材、发布、作词和番茄回执的查询复用已有校验。现有数据库格式、历史任务及作品归档可继续使用。

## 验证结果

- 同一台 Windows 主机上，使用含 8 个计划、24 次执行及 72 条歌曲明细的 SQLite 隔离样本，前后各读取 3 次。首屏计划 Core 查询的中位耗时从 1700.50 ms 降到 0.80 ms，返回 JSON 从 186355 字节降到 7539 字节。任务列表中位耗时从 9.09 ms 降到 0.57 ms。计时范围为本地 Core 查询。
- `Start-Rainfall-Browser.bat -BuildOnly` 和 TypeScript 检查通过。12 项界面与浏览器测试通过，覆盖首屏读取、新增及编辑保存、任务展开、执行记录跳转、停止和删除。通过延迟响应核对加载图标，并确认计划列表能在全库快照请求等待时显示。
- 84 项计划、任务和归档测试，28 项计划中心测试，3 项模型目录测试及 8 项流水线回归通过。Windows Electron Node 模式另外通过 2 项读取和关联执行验证。使用隔离库及无头测试，Windows 原生窗口待验收。

## 回退

回退时恢复本轮所列源码和测试变更，通过原 `Start-Rainfall-Browser.bat` 重新构建。查询沿用既有表，原数据可直接读取。桌面入口切换按项目的原生验收流程执行。
