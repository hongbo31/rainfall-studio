# 苏诺之音 WAV 转换超时恢复

2026-11-22

浏览器开发库的最新任务于北京时间 02:25 结束。任务已派发一次创作，识别到两首结果，停在 `download`，没有归档文件。仍在运行的 `source-a5cef1a5` 快照早于 WAV 菜单兼容修复。用该快照的原驱动和官网「下载 WAV 音频」菜单变体复现了 `PULE_BROWSER_INTERRUPTED`。历史日志只记录了通用错误码，无法确认当时的具体控件异常。

- `src/main/suno-cn-browser-page.ts` 核对 WAV 转换窗口，识别官网的「获取 WAV 文件超时，请稍后重试」提示。出现本次转换的新超时提示且弹窗已经关闭时，从同一首已识别的歌曲重查一次 WAV。收到下载事件后进入接收阶段。查看另一首歌前等待原下载窗口关闭。
- `src/renderer/components/PuleBrowserGeneration.tsx` 显示转换失败、下载按钮不可操作和下载窗口未关闭的具体原因。处于下载阶段的历史通用中断记录提示原歌曲已生成、WAV 未完成。
- `tests/suno-cn-browser.test.mjs`、`tests/fixtures/suno-cn-browser.html` 与 `tests/platform-management-ui.test.mjs` 验证转换超时重查原歌、其他转换错误停止、创作点击一次、两首 WAV 和各自封面歌词归档，以及历史错误解释。

## 验证与交付状态

- 以先前可构建的源码快照为基线，在同级隔离目录叠加本次修改。25 项回归、TypeScript 检查和共享 Main、Core、预加载及渲染层构建通过。Windows 与浏览器共用上述代码。
- 当前完整检出的 `Start-Rainfall-Browser.ps1 -BuildOnly` 在独立的远控迁移处失败。`scripts/build-desktop.mjs` 仍引用已移除的 `src/main/sms-apk.ts`，短信页面也仍引用已移除的共享模块。本轮仅修改苏诺之音下载和执行记录相关代码。
- 本轮只读查询真实任务历史。当前窗口保留原快照。独立 Electron 后台宿主烟测未收到启动回执，真实账号歌曲和 Windows 原生窗口待验收。两首历史结果可在「我的创作」核对。完整构建恢复后沿用现有 `Start-Rainfall-Browser.bat`。
- 回退时撤销本次下载等待、执行记录提示和对应测试。历史记录和归档数据格式沿用原有格式。
