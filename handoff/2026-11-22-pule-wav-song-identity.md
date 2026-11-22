# 谱乐 WAV 下载识别原歌曲

2026-11-22

## 现场与原因

只读核对 11 月 21 日 23:44:56 启动的「素素每日任务」。当时运行的浏览器快照已经包含上一轮 WAV 传输修复。关联计划「日常」首轮《雨打窗沿慢慢数》在 23:48:26 保存两首歌的生成回执，23:52:24 在下载阶段记录 `PULE_DOWNLOAD_NOT_STARTED`。现场记录包含两条列表歌曲 ID，未留存当时 WAV 请求使用的 ID。

谱乐官网的歌曲详情链接使用 `songId`。从歌曲菜单准备 WAV 以及点击「下载文件」时，官网优先使用 `musicSongId`，再回退到 `songId`。WAV 就绪时，弹窗也会显示原歌曲的 `.wav` 文件名。旧逻辑只用列表中的 ID 监听下载，官网用内部 ID 时会漏掉请求。无头环境模拟两种 ID 和网站的两次请求，改动前复现了同一个超时错误。[谱乐歌曲列表和 WAV 请求](https://static.yourmusic.fun/_next/static/chunks/32685-e1cc8643e3eaca3f.js) · [谱乐 WAV 弹窗](https://static.yourmusic.fun/_next/static/chunks/25814-9e82f8e04526e6ef.js)

## 改动与影响

- `src/main/pule-wav-transfer.ts` 在任务页点击所选歌曲的 WAV 菜单后识别准备请求的内部 ID。最终下载用已识别的 ID 匹配官网请求，继续使用已有的分段等待和新标签接收。传统浏览器下载流程仍受支持。内部 ID 只在当前页面操作期间使用。
- `src/main/pule-browser-page.ts` 在最终下载前核对就绪弹窗的文件名和所选歌曲。出现不同歌名、无法唯一确认的准备请求或两首歌复用同一个下载 ID 时，停在该版并显示原因。保存、归档和补下载仍使用原生成回执中的歌曲 ID 与 A/B 对应关系。
- `src/renderer/plan-execution-labels.ts` 和 `src/renderer/components/PuleBrowserGeneration.tsx` 显示无法核对原歌曲的错误。任务中心、计划中心和平台管理共用下载规则。
- `tests/pule-browser.test.mjs` 和 `tests/fixtures/pule-browser.html` 模拟列表 ID 与 WAV 内部 ID 不同、弹窗歌名不符、两首歌收到相同下载 ID，以及 B 版临时失败后只补 B 版。验证两版音频内容、文件名、原回执、提交次数和页面关闭。

## 验证

构建、测试数据和日志位于源码同级 `rainfall-studio-build/pule-wav-identity-636efe0b`。实际计划记录只读，恢复试验用内存库与拦截网络的无头页面，下载内容为合成 WAV。

| 范围 | 结果 |
| --- | --- |
| 谱乐自动化 | 59 项通过，覆盖两种 ID、A/B 下载、新标签、临时失败和积分不足 |
| 原执行记录 | 23:44 的原回执在内存库开始第 2 次下载阶段。驱动根据同一对作品 ID 完成两版模拟 WAV 下载，生成阶段仍只有原来的记录 |
| 计划、任务顺序和归档 | 71 项通过，含补下载、失败后继续下一计划和双版归档 |
| 浏览器预览 | 原启动脚本隔离 `-BuildOnly` 通过，浏览器桥接及共用界面回归 6 项通过 |
| Windows 客户端 | TypeScript、Main、preload、Core 和界面构建及语法检查通过。Windows Electron 的 4 项新增和相关无头用例通过 |
| 基础与全库集成 | 基础 3 项通过。全库集成新旧版均为 229 项通过、相同 5 项失败 |

全库对照中的 5 项失败分别是 `material-routing.test.cjs` 的 100 首歌词素材目录缺失，`simple-publishing.test.cjs` 的两项 TME 待确认条款计数，`studio.test.cjs` 的首次定时迁移，以及 `workflow-client.test.cjs` 的候选录音就绪断言。新旧版日志分别为 `candidate-integration.log` 和 `baseline-integration.log`。

正式谱乐账号下载和 Windows 原生窗口仍待验收。当前用户目录未找到 `verified-desktop.json`，桌面入口未切换。生产数据用于只读核查。

## 生效与回退

- 正常退出当前浏览器会话后，从原 `Start-Rainfall-Browser.bat` 入口启动即可载入本次修复。
- 恢复旧执行时，从 23:44 记录的「查看执行」进入首轮「下载歌曲」，点击「重试此阶段」。重试从原歌曲回执开始。
- 回退时撤回本轮列出的源码和测试差异并重新构建。原计划、作品 ID、历史回执和归档文件无需迁移。桌面入口继续按 `docs/release/desktop-delivery-policy.md` 的验收流程切换。
