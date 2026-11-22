# 谱乐 WAV 下载等待和重试

## 现场记录

截图中《你留的那把伞》的 WAV 已在谱乐弹窗里就绪，点「下载文件」后页面持续提示「正在下载」。只读核对了同一轮《雨打玻璃一年又一年》和《你留的那把伞》的计划记录。首次生成已保存两个谱乐歌曲 ID，下载重试在北京时间 20:38:03 进入等待，20:43:53 记录 `PULE_DOWNLOAD_TIMEOUT`。这条旧记录无法区分浏览器未收到下载事件与文件传输未完成，实际服务端卡住的原因未确认。

## 改动与影响

- `src/main/pule-browser-page.ts` 在点击「下载文件」前订阅当前页的下载事件。90 秒内没有事件时记录 `PULE_DOWNLOAD_NOT_STARTED`。已有传输的 5 分钟期限由接收处理单独计算。超时后关闭本次任务页，在新任务页用原歌曲 ID 只重试一次，避免旧页面迟到的下载事件进入重试。
- `src/main/pule-browser.ts` 为 WAV 接收设置可独立结束的截止时间。卡住时记录 `PULE_DOWNLOAD_TIMEOUT` 并请求取消，传输迟到时清理对应临时文件。平台管理依据已保存录音选择缺失版本，重试继续处理该版本的歌词和封面。
- `src/main/plan-pule.ts` 让计划中心复用同一下载回执，并在当前下载阶段的自动重试中保留已接收的 WAV。两首均齐备后照常核对歌名、导入作品库和归档。重复超时后该阶段记录失败，生成回执仍可供后续重试。
- `src/shared/pule-browser.ts` 和 `src/renderer/components/PuleBrowserGeneration.tsx` 分别显示等待谱乐发送 WAV 和正在接收 WAV。`src/renderer/pages/PlanCenter.tsx` 显示未开始发送与传输超时两种结果。
- `tests/pule-browser.test.mjs`、`tests/fixtures/pule-browser.html` 和 `tests/plan-workflow-refactor.test.mjs` 模拟官网提示「正在下载」却没有文件事件、两次超时、取消后传输仍未结束，以及计划依据原回执仅补 B 版。

## 验证与交付

在源码同级 `rainfall-studio-build/pule-download-wait-c4c4df72/source` 的隔离副本运行。浏览器与 Windows 客户端共用下载驱动、计划执行和文件写入逻辑。模拟素材覆盖保留 A/B 对应、只发生一次歌曲生成和迟到的临时 WAV 被清理。

| 验证范围 | 结果 |
| --- | --- |
| 谱乐自动化 | 51 项无头测试通过，覆盖重试成功、再次超时、保留 A 版和迟到临时文件清理 |
| 计划工作流和下载归档 | 47 项通过，覆盖原回执补下载、归档、停止与既有数据 |
| 平台管理和计划中心界面 | 3 项无头测试通过 |
| 浏览器桥接及基础行为 | 4 项通过，使用构建后的页面 |
| Windows 构建 | TypeScript、Main、preload、Core、UI 构建，以及 Main、Core 语法检查通过 |

浏览器从现有 `Start-Rainfall-Browser.bat` 启动时使用当前源码构建。原计划详情的「下载歌曲」失败阶段可重试，之后仍按已有歌名、歌手目录及配置归档。正式账号下载、Windows 原生窗口和桌面入口切换尚未验收。本轮现场检查为只读。

如需回退，只撤回上述本轮改动并重新构建，原计划回执、已生成的歌曲及下载档案可按原工作区读取。
