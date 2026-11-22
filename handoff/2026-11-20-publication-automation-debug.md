# 发布平台自动化调试

## 改动与影响

- `src/renderer/pages/PlatformManagement.tsx` 为六个发布平台添加「执行」按钮。`src/renderer/components/PublicationAutomationDialog.tsx` 和 `src/renderer/platform-management.css` 提供右侧调试面板。面板带入默认发布账号，单独选择的账号仅用于当次调试。选择作品和账号后，使用面板内的对应动作执行。
- 番茄音乐调用所选账号已有的上传流程，使用指定 A/B 录音和对应作品资料，显示处理进度及官网状态。汽水音乐复用现有填表、上传和合同确认界面。`src/renderer/components/QishuiPublisher.tsx`、`src/shared/qishui.ts` 和 `src/core/qishui-work.ts` 为独立调试传入对应版本的歌手、标题、歌词和封面。QQ 音乐和酷狗音乐沿用作品在库中选定的录音版本，执行已有的发布准备并显示进度。
- 网易云音乐、抖音视频和离线验收模式提供本地材料预检。`src/shared/platform-config.ts`、`src/core/studio.ts` 和 `src/core/simple-publication.ts` 新增只读 `publish.preview`，校验目标账号，并返回作品版本和缺项。`src/shared/offline-acceptance.ts` 允许在隔离验收中执行这个只读检查。
- 官网登录、查重、授权、合同确认和回执核对继续由现有平台流程处理。调试使用现有作品、账号及发布记录格式。可用的平台操作由用户在面板中发起。

## 验证

- 平台管理、汽水表单、浏览器桥接、发布任务及发布界面定向回归共 18 项通过。`tests/platform-management-ui.test.mjs` 用隔离账号和录音覆盖所有六个目标、默认账号、调试账号与版本、准确派发和结果展示。
- TypeScript 检查与 `Start-Rainfall-Browser.bat -BuildOnly` 通过。浏览器使用构建后的本地 HTTP 桥接、隔离 SQLite 库和无头 Chromium，验证六个入口及抖音材料预检。记录在同级构建目录 `publication-http-88a3c338`。
- Windows 随包 Electron 以 Node 模式通过 `tests/integration/simple-publishing.test.cjs` 的新增预检用例，验证账号与平台校验以及预检的只读性。记录在同级构建目录 `publication-runtime-8f991416`。`tests/offline-acceptance.test.cjs` 的三项隔离边界测试通过。
- 发布集成套件 23 项通过。两项腾讯待授权材料检查的既有断言失败，旧构建也复现设置记录数实际为 12、预期为 11。Windows 原生窗口、实站上传与合同操作待验收。

## 使用与回退

沿用同一个 `Start-Rainfall-Browser.bat`，在「平台管理 → 发布平台」打开对应调试面板。Windows 桌面入口在原生验收后按项目交付流程切换。回退时撤销上述源码和测试改动，保留作品和发布回执。遇到先前已有投稿记录时，沿用现有的官网核对流程。
