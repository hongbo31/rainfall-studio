# 诊断日志与截图 7 天保留

## 原因

番茄自动化的 trace 和错误截图会按运行批次持续累积，原生生命周期诊断也会轮转但不会按日期到期。新增统一保留期，降低长期运行后诊断文件占用的空间。

## 实现

- `src/main/diagnostic-retention.ts` 定义 7 天期限和安全的定向清理。
- `src/main/bootstrap.ts` 在取得 workspace lease 后执行首次清理，并每小时执行一次；仅生产运行启用。进程退出或重启后会在下一次启动再次清理。
- `src/main/fanqie/directory-trace.ts` 按 JSONL 行内 `at` 时间移除已过期 trace 记录，并将清理排在该 trace 的待写队列之后。错误截图按文件修改时间清理。
- `src/core/publication-task-integration.ts` 在 Core 生产 tick 中每小时触发一次 `PublicationTaskService.pruneLogsBefore()`，从发布任务的执行记录中移除 7 天以前的日志项；保留每次执行的状态、摘要、关联计划和请求 ID。
- 清理范围是已知的原生生命周期 JSONL 及其两份轮转文件、Fanqie 操作/上传诊断快照、Fanqie `download-runs/<UUID>/trace.jsonl` 与对应错误截图，以及 `evidence/tme-ai/*-native-error.json`。两类 JSONL 都逐行按 `at` 字段过滤，避免近期追加内容让文件内的旧日志一直保留；截图和快照以修改时间判定。
- 无法解析或缺少有效 `at` 的诊断 JSONL 行会被移除，因为不能证明其仍在 7 天期限内；发布任务日志项也要求时间戳有效。
- 路径限定在当前解析的数据根下的应用自有目录；扫描跳过符号链接、未知文件名和非普通文件。诊断目录不做任意递归。
- 保留批次状态、签约/验证回执、上传任务、账号配置与登录态、作品和素材。计划中心阶段/发布尝试状态与官网回执继续供续跑、去重及核对使用；发布任务执行摘要与当前状态也保留。

## 文件与影响

- 修改：`src/main/bootstrap.ts`、`src/main/fanqie/directory-trace.ts`、`src/core/publication-tasks.ts`、`src/core/publication-task-integration.ts`。
- 新增：`src/main/diagnostic-retention.ts`、`src/shared/diagnostic-retention.ts`、本交接文件。
- 更新：`handoff/PROJECT-HANDOFF.md`。
- Windows 桌面版与 Rainfall Browser 入口共用 Main 清理逻辑；首次及每小时清理均在持有数据根租约的主进程中运行。

## 验证与未验证

- 完成源码静态审阅和 `git diff --check`。
- 未运行测试、构建、真实文件清理、实际官网自动化或 Windows 原生验收。
- 未读取生产数据根；桌面指针和生产库均未参与本轮实现。自动清理将在包含此代码的新版本运行后生效。

## 回退

移除 `src/main/diagnostic-retention.ts`，撤销 `bootstrap.ts` 的清理器导入、调度函数和 lease 后调用；撤销 `directory-trace.ts` 的 `pruneFanqieTraceFile` 导出及 `traceKey` 辅助函数，并移除本文件及 `PROJECT-HANDOFF.md` 对应记录。回退不会恢复已经过期删除的诊断日志或截图。
