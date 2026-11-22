# 平台管理卡片的页面与执行

2026-11-20

## 使用

1. **打开页面。** 14 张卡片的右上角都有入口。发布平台使用默认账号，只有一个已存账号时也可直接打开。谱乐和 Suno 使用卡片所选账号。选定账号后，通过其专属窗口核对登录。谱乐与汽水会刷新已知登录状态，番茄可显示官网核对结果。其他专属窗口打开后提示用户在窗口核对。
2. **执行发布调试。** 六个发布平台从卡片右上角打开调试面板。按平台选择所需账号、作品与录音版本，再用面板里的操作执行。番茄、汽水、QQ 音乐和酷狗继续通过已有自动化处理，依照各自的回执和确认步骤执行。网易云音乐、抖音视频执行本地材料预检。[发布调试流程](./2026-11-20-publication-automation-debug.md)
3. **执行谱乐制作。** 点击卡片或右上角「执行」打开右侧制作面板。填好歌名、风格和歌词或纯音乐选项，再点面板内的「开始制作」。通过底部的「执行记录」查看各阶段和 A、B 版归档。翻唱沿用版权音频授权与处理流程。[歌曲生成面板](./2026-11-21-platform-music-generation-panel.md)
4. **执行文本模型测试。** DeepSeek 和豆包的「执行」打开调试面板，列出该平台的模型配置并优先选用匹配的默认配置。确认测试内容后点「开始测试」，核对 API Key 并通过既有作词任务执行一次作词和评分。面板显示生成结果和评分状态，任务也可在「AI 作词」查看。
5. **查看待接入渠道。** Suno、妙响、Codex CLI 和 Claude Code 有官方页面入口，点击「执行」会显示自动化接入状态。没有指定服务商的占位卡提示配置页面；存在多个账号时按卡片提示选择账号。使用已核对的官方入口打开模型平台和控制台。[妙响](https://music.douyin.com/studio) · [DeepSeek](https://api-docs.deepseek.com/zh-cn/) · [火山方舟](https://ark.volcengine.com/region:cn-beijing/overview) · [Codex](https://chatgpt.com/codex/) · [Claude Code](https://code.claude.com/docs/en/claude-code-on-the-web)

## 涉及文件

- `src/renderer/pages/PlatformManagement.tsx`、`src/renderer/components/PlatformCardHeader.tsx`、`src/renderer/components/PuleBrowserGeneration.tsx` 和 `src/renderer/platform-management.css` 共用卡片右上角布局，分配页面与执行操作。
- `src/renderer/account-session.ts` 和 `src/renderer/pages/PlatformAccounts.tsx` 共用登录状态文案。`src/shared/platform-directory.ts` 与 `src/main/bootstrap.ts` 使用固定的官方页面表和现有桌面桥接。
- `src/renderer/components/TextAutomationDialog.tsx` 通过既有凭据检查和 AI 作词调用测试模型。发布调试继续读写原来的作品、账号和回执记录。

## 验证与回退

- 无头浏览器回归使用隔离账号、模型响应和发布回执。`tests/platform-management-ui.test.mjs` 验证了 1000 和 1360 像素窗口下 14 张卡片的按钮位置，覆盖账号范围、谱乐提交、文本配置与 API Key 检查、未接入提示。
- 平台管理用例和 98 项相关回归通过。TypeScript 检查以及 Windows Main、Core、预加载和两端共用渲染层构建通过。
- 旧发布中心的 `tests/publication-pipeline-ui.test.mjs` 复现了已记录的 CSS 打包问题。隔离探查继续到页面后，旧用例等待「发布」按钮超时。发布卡片、合同确认和相关进度用例各有独立验证覆盖。[既有测试记录](./2026-11-20-path-portability.md)
- 真实账号登录及执行、计费调用和 Windows 原生窗口待验收。

回退时撤销本轮卡片布局、页面映射、共享登录状态、调试面板及对应测试后重建。账号、作品及任务沿用已有数据结构。
