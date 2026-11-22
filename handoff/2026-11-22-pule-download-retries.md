# 谱乐 AI 下载超时与重试

2026-11-22

## 行为

原流程等待浏览器开始下载最多 90 秒，准备 WAV、接收音频和保存临时文件分别计时。现在每次尝试从请求准备 WAV 开始，共有 10 分钟等待地址及接收完整音频。超时计为一次失败，取消未完成的传输并清理临时文件。

每首歌有一次初始下载和最多三次自动重试。官网弹窗里的「重试」和重新打开任务页消耗同一个次数，A、B 版各自计数。恢复时根据原回执补下载缺少的版本，已经保存的版本、关联歌词和封面可继续使用。身份、权限、文件格式和本地保存异常保留对应的停止原因。

谱乐 API 下载同样按每次 10 分钟处理。独立的工作流使用三次自动重试，已有重试记录的音乐流程继续由原任务计数。数据库和任务记录格式沿用原有结构。

## 文件

- `src/shared/pule-browser.ts` 定义下载时限和重试次数。
- `src/main/pule-browser-page.ts`、`src/main/pule-wav-transfer.ts` 和 `src/main/pule-browser.ts` 共用每次尝试的截止时间，协调弹窗及跨页面重试并回收临时文件。
- `src/main/plan-pule.ts` 把浏览器下载的截止时间传到计划文件保存，API 路径启用同一重试规则。`src/renderer/plan-execution-labels.ts` 显示下载超时和重试耗尽。
- `src/core/workflow/yourmusic.ts` 为音频请求设置可取消的时限。`src/core/index.ts` 给跨进程下载结果留足时间。`src/main/material-workbench.ts` 和 `src/main/production-flow.ts` 在独立流程下载中启用重试。
- `tests/pule-browser.test.mjs`、`tests/plan-workflow-refactor.test.mjs` 和 `tests/integration/workflow-music.test.cjs` 覆盖第三次重试成功、耗尽、各版本计数、共用时限和取消后清理。

## 验证与回退

- 隔离 Chromium 和计划下载定向回归 7 项通过。测试压缩页面时限，并用模拟时钟验证在 10 分钟到期时取消。
- API、旧音乐任务和制作流程回归 39 项通过。素材流程另用合成素材验证 5 项通过。
- 浏览器及相关回归 121 项中 119 项通过。平台管理和计划中心的整页测试因当前检出缺少 `src/shared/sms-inbox.ts` 无法构建界面。浏览器与 Windows 客户端共用代码的定向类型检查，以及 Main、preload 和 Core 构建与语法检查通过。
- 原浏览器启动脚本的 `-BuildOnly` 在打包脚本引用缺失的 `src/main/sms-apk.ts` 时停止。真实谱乐账号慢网下载及 Windows 原生窗口待验收，桌面入口未切换。
- 日志和隔离构建位于 `../rainfall-studio-build/verification/pule-download-retries-d37aaa57`。恢复缺失的构建依赖后，从原浏览器入口构建。回退时撤回上面列出的本次差异，既有作品、账号配置和歌曲回执兼容。
