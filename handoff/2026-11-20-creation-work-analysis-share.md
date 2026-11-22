# 创作中心作品分享与 AI 听辨

2026-11-20

## 改动原因与行为

作品详情新增「分享给 AI」。可以分别下载已绑定的 A、B 版原始音频，保留原格式和文件字节。复制分析资料后，可把资料和所选音频一起交给能读取音频的 AI。剪贴板不可用时显示可手动复制的资料。

资料包含作品名称、录音文件名、已保存的歌词和风格提示词，以及现有的生成模型和创作设置。与当前音频匹配的回传歌词有差异时会另列。资料引导 AI 区分响度、音高、唱法、编曲和混音，用时间点指出现象，并给出可重试的风格提示词。

浏览器使用当前会话的本地音频流。Windows 客户端通过保存对话框导出，提交时重新核对作品、音频绑定和文件哈希，并保护作品库路径。数据格式和数据库 schema 沿用现有版本。

## 涉及文件

- 分享面板与布局 `src/renderer/components/CreationWorkShare.tsx`、`src/renderer/pages/ChatCreation.tsx`、`src/renderer/creation-workspace.css`。
- 分析格式、音频导出与桌面调用 `src/shared/work-analysis.ts`、`src/core/work-audio-share.ts`、`src/core/index.ts`、`src/main/bootstrap.ts`。
- 回归测试 `tests/work-analysis-share.test.mjs`、`tests/creation-work-detail.test.mjs`。

## 验证和回退

- 从原浏览器启动入口完成后台构建，生成共用的渲染页面和 Windows Main、预加载、Core。
- 使用已构建的浏览器工作台、无头 Chromium 和隔离测试库实际下载 A、B 两个 WAV，两份文件均与源文件逐字节一致。验证了分析资料复制、只有 B 版、没有音频及剪贴板不可用的交互。
- Windows Electron 的 Node 模式验证了保存的录音与源文件一致、版本绑定变化时拒绝导出、禁止写入作品库以及检测损坏音频。类型检查和八项定向测试通过。Windows 原生保存对话框和正式桌面包待验收。录音使用测试音频，实际听辨交给用户选择的 AI。
- 如需回退，只撤回本文件列出的分享相关改动。作品和音频沿用现有存储，可以继续由旧版读取。
