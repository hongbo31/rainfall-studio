# 番茄上传后的下载文件回收

## 原因

- 「素素任务2」在 2026-11-22 17:18:48 的执行中，「番茄音乐平台上传」保存了 30 首歌的上传回执。对照回执和 Windows 回收站记录，90 个下载文件中有 41 个已移入回收站，49 个在核对时仍留在下载目录。
- 首个遗留文件是第 14 首《雨巷等归人》的 JPG 封面。原回收循环遇到错误后立即退出，后面的文件未获处理。旧日志只保留通用错误码，无法确定当时 Windows 拒绝操作的具体原因。

## 改动

- `src/main/fanqie/recycle-file.ts` 和 `src/main/fanqie/directory-run.ts` 在回收前核对文件身份，回收后检查原路径。对仍在原位置的文件最多再试两次。单个文件最终失败后，记录对应歌曲序号、材料类型和错误码，继续回收本批其他合格文件。未确认上传的材料、共享给待上传歌曲的材料、版权证明和正式作品库受路径及文件身份校验保护。
- `src/core/plan-fanqie-directory.ts`、`src/main/fanqie/plan-directory-publisher.ts` 和 `src/main/bootstrap.ts` 为已有完整上传回执且未请求合同的失败批次提供本地回收重试。入口按原账号和执行 ID 读取批次，使用保存的作品 ID、歌名和原音频身份核对回执，串行使用该账号的发布锁。重试只执行文件回收，完成标记写入原批次。
- `src/core/plan-center-reads.ts`、`src/core/publication-task-integration.ts`、`src/shared/plan-center.ts`、`src/shared/fanqie-downloads.ts`、`src/shared/schemas.ts` 和 `src/renderer/pages/PlanCenter.tsx` 提供「重试回收」按钮、进行中提示和已补回收状态。任务中心保留原执行结果，并显示回收已完成。浏览器版和 Windows 客户端走同一个 Main 处理入口和 Core 数据。

## 验证

- 在隔离目录用 `tests/fanqie-downloads.test.mjs` 复现单文件回收失败中断整轮的问题。回归验证了后续文件继续回收、旧批次复用原回执、回执变化时拒绝操作、二次重试幂等及共享版权证明保护。`tests/fanqie-recycle-file.test.mjs` 验证短暂占用、持续失败、文件替换、链接路径、操作中止及 Windows 返回与文件现状不一致。
- 番茄目录、回收、归档、计划及任务专项 159 项通过。旧计划专项 18 项通过。浏览器界面和桥接等 9 项通过，包含任务中心从「查看执行」进入旧批次并点击「重试回收」。TypeScript 和原 `Start-Rainfall-Browser.bat -BuildOnly` 构建通过。
- Windows Electron 无窗口验证中，持有文件句柄时第一次回收被系统拒绝，释放后第二次成功，通过回收站元数据确认了测试文件原路径和内容。另用同版构建和隔离库，通过真实浏览器 RPC 重试历史批次，成功回收音频、歌词、封面，并核对回执和历史执行记录。
- 全量集成改动前后均为 233 项通过，6 项失败。基线失败涉及百首歌词夹具、文本队列、腾讯待条款和旧计划调度。日志位于 `../rainfall-studio-build/fanqie-recycle-integration-20261122/temp/integration-with-media.log`。
- 真实批次只读检查确认 30 条原回执与剩余 49 个文件符合补回收范围。此次开发测试使用测试文件。正式番茄上传和 Windows 原生窗口待验收，运行中的预览和桌面交付入口保留现行版本。

## 使用与回退

- 原浏览器预览退出后用原 `Start-Rainfall-Browser.bat` 加载新版。在「任务中心 → 素素任务2 → 番茄音乐平台上传 → 查看执行」点击「重试回收」，核对「下载文件已补回收」。仍遇到文件占用时，可在释放文件后对原记录再次重试。
- 回退时恢复上列源码与本次测试改动后重建。数据无需迁移，已回收的下载文件可从系统回收站还原。
