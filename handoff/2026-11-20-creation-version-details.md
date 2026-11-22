# 创作中心按 A、B 版展示作品详情

2026-11-20

## 改动与影响

- 创作中心将已有音频的 A、B 版直接列为独立作品行，删除其上层汇总行。歌名搜索分别匹配各版，风格搜索可匹配同一作品的两版。只有一版音频时显示实际已有的一版。
- 点击作品行打开对应版本的侧栏详情，显示本版歌名、封面、歌手、试听和已回传的演唱歌词。共享创作歌词与授权资料仍可查看或编辑。B 版歌名编辑写入原有的 `alternateTitle` 字段。只有 B 版的旧作品沿用已有的歌名和封面回退规则。
- 行内试听与封面操作指向当前版本。详情内「分享给 AI」只下载该版的原始音频，分析资料与文件名使用该版歌名。关闭详情后焦点回到所点作品行。
- 尚未收到音频的任务在下方「任务状态」显示进度及可用的核对操作。无音频的普通草稿可在作品库查看。作品级发布操作继续从作品库详情使用。

## 涉及文件

- 版本列表、详情选择与样式涉及 `src/renderer/components/CreationWorkspace.tsx`、`src/renderer/pages/ChatCreation.tsx`、`src/renderer/pages/Track.tsx`、`src/renderer/context.tsx` 和 `src/renderer/creation-workspace.css`。
- 分享和导出涉及 `src/renderer/components/CreationWorkShare.tsx`、`src/shared/work-analysis.ts` 和 `src/core/work-audio-share.ts`。
- 回归检查更新 `tests/creation-work-detail.test.mjs` 和 `tests/work-analysis-share.test.mjs`。

## 验证与回退

- 原 `Start-Rainfall-Browser.bat -BuildOnly` 成功构建浏览器与 Windows 共用的渲染层、Main、Core 和预加载。用构建后的浏览器服务、无头 Chromium、隔离 SQLite 和两段测试 WAV 验证平铺列表、两张封面、两版真实本地音频及 B 版下载文件名和字节。
- TypeScript 检查和 31 项定向测试通过。测试覆盖仅有 B 版的旧数据、歌名搜索、B 版改名、歌手与歌词区分、封面导入范围、键盘焦点和窄屏详情。待验收范围包括 Windows 原生窗口与正式桌面包。本轮使用测试素材，未调用正式生成或发布流程。
- 退出浏览器预览后使用原 BAT 重新启动。回退时撤回本轮涉及的源码与测试改动，使用原有数据格式即可读取作品。
