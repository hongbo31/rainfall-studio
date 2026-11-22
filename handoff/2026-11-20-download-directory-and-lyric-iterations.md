# 统一下载目录与逐轮优化歌词

2026-11-20

## 下载和归档

- 计划拿到音频和歌词后，在等待封面的阶段先归档已齐备的文件。封面和其余材料到齐时再次核验并归档。已写入的文件通过版本和校验值识别，可继续同一次执行。
- 路径使用「配置中心 → 下载目录」实际保存的设置。执行期间更换目录，下一次归档会在新位置按计划原有的账号、歌手和提示词引擎创建或复用文件夹，执行详情同步显示当前归档路径。旧目录中的文件可继续查阅。
- 浏览器和 Windows 客户端的音频、原创证书、作词 TXT、封面和发布材料导出共用本地保存入口。未配置下载目录时提示先选择目录。手动下载遇到同名文件时自动追加编号。备份与诊断的保存位置由用户在各自的导出对话框中选择。
- `src/core/download-archive.ts`、`src/core/plan-center-integration.ts` 和 `src/renderer/pages/PlanCenter.tsx` 处理计划目前的归档及 A/B 目录展示。`src/core/download-artifact.ts`、`src/core/index.ts`、`src/main/bootstrap.ts` 和 `src/shared/download-archive.ts` 接通共用下载入口。用户提示和按钮见 `src/renderer/main.tsx`、`src/renderer/components/DownloadArchiveSettings.tsx`、`src/renderer/components/CreationWorkShare.tsx`、`src/renderer/components/CreationWorkspace.tsx` 和 `src/renderer/pages/LyricWriting.tsx`。

## 逐轮优化

- 第一次评分基于初稿。每轮改写请求发送当前歌词及这版的评分、语种判断和评语。下一次评分对应刚完成的改写。达到目标分且语种符合要求时直接采用该稿。用尽改写次数后，设置了目标评分的任务按最高分采用结果。
- 若 AI 返回完全相同且已有评分的歌词，该次改写计数，复用匹配的评分。进度面板显示实际的当前稿和评语，结果栏、复制、TXT 和快速生成使用同一采用稿。
- `src/core/lyric-writing.ts`、`src/shared/lyric-writing.ts` 和 `src/renderer/pages/LyricWriting.tsx` 实现流程和显示。当前稿 ID 和改写轮次以可选字段存储，已有任务可继续读取。

## 验证与回退

- 隔离测试复现了封面等待时目录为空、换目录后归档读旧路径，以及低分改写后把初稿重新发给模型。下载回归核对双歌手目录、原始音频字节、封面 PNG、证书、材料 ZIP、同名文件和实际采用稿 TXT。
- 计分夹具核对第三轮使用第二轮歌词和该轮评语，并验证提前达标结束、重复稿恢复和改写上限。浏览器无头验证界面步骤和本地会话桥接，Windows 主进程、Core、预加载及两端共用渲染层完成隔离构建。
- TypeScript 检查、88 项定向回归及基础的 3 项测试全部通过。谱乐 Playwright 夹具也通过。使用现有媒体工具运行集成回归，234 项中 230 项通过。剩余 4 项在修复前副本复现，分别涉及缺少 100 首外部素材、两项腾讯待授权平台数量以及旧计划的调度预期。另有一项旧封面界面断言在修复前后均找不到「图片接口未配置」。
- 已有生产作品、配置和运行入口按当前交付策略保留。Windows 原生窗口与真实平台生成待验收。回退时撤回本轮代码和对应验收用例，使用已验收版本并保留现有作品库与归档。
