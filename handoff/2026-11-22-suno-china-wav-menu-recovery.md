# 苏诺之音 WAV 下载菜单修复

2026-11-22

实际任务日志记录了 1 次创作派发、2 条已确认结果和 0 份文件，最后停在 `download`，旧错误码是 `PULE_BROWSER_INTERRUPTED`。旧日志只保留通用错误码。官网的自定义歌曲菜单同时存在「下载wav音频」和「下载 WAV 音频」两种文案。用后者的本地网页替身复现了同一阶段和错误码，旧驱动在等待精确文本时超时。

- `src/main/suno-cn-browser-page.ts` 兼容 WAV 菜单的大小写和空格，并继续校验选中的歌曲及所属子菜单。改名和 WAV 入口缺失各自有明确错误码。原始音频选项仍按其自身名称区分。
- `src/renderer/components/PuleBrowserGeneration.tsx` 在两端共用的执行记录中区分改名菜单缺失、WAV 菜单缺失、WAV 转换等待和传输未开始。
- `tests/suno-cn-browser.test.mjs` 与 `tests/fixtures/suno-cn-browser.html` 覆盖带空格的大写菜单、原 WAV 菜单和仅有原始音频的菜单。测试检查两首归档顺序，以及菜单缺失时只记录一次派发并保留已生成结果。

## 验证与回退

- 23 项回归测试、TypeScript 检查和 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过。
- 本轮只读检查浏览器开发入口所使用的任务日志，并在同级隔离构建中验证浏览器与 Windows 共用的执行代码。真实账号的 WAV 下载和 Windows 原生界面待验收。历史中断任务保留在执行记录中。
- 回退时撤销 WAV 定位器、对应错误提示和测试场景。无需更改任务数据格式、账号或归档目录。
