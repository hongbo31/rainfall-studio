# 番茄目录上传实时选择署名

2026-11-23

## 原因和改动

08:49 的「素素」批次有 23 首进入预检。4 首因同名作品跳过，19 首在打开表单前报 `FANQIE_ARTIST_NAME_NOT_FOUND`。原来只拿「合作艺人」当前页的 10 条记录匹配署名，第一页之外的歌手会被漏掉。该批没有进入发布表单。

- `src/main/fanqie/directory-run.ts` 负责本批账号和歌名核对，按配置的词曲署名与目录歌手准备歌曲。通过本地材料检查的歌曲直接进入「发布作品 → 成品发行 → 上传歌曲信息」。平台管理、计划中心和任务中心的目录上传共用这一流程。
- `src/main/fanqie/directory-form.ts` 在每首歌当前表单的下拉框查询、确认并核对署名回显。没有匹配结果和多个同名结果分别记录。失败日志带该歌曲序号和词作者、曲作者或歌手步骤。最终确认上传前仍核对本批所有填写值和同名作品。
- `src/shared/fanqie-downloads.ts` 提供上传表单署名查询的错误提示。`src/renderer/components/FanqieDownloadUpload.tsx` 在新批次运行期间展示当次进度，收到结果后刷新批次。诊断文件按执行 ID 归档。已上传作品通过原始回执识别。

## 验证和交付

在源码同级 `rainfall-studio-build/fanqie-live-credits-mwsnpkon` 使用隔离目录和模拟官网。

| 范围 | 结果 |
| --- | --- |
| 目录批次和恢复 | 62 项通过。历史批次保留缺少署名记录时，新批仍将「锤宝里」「锤七叶」送入表单，并跳过已有投稿 |
| 官网流程与表单 | 3 项目录流程、24 项无头表单测试通过。模拟官网通过下拉框选择名册首页之外的艺人，仅提交一次并读回作品 ID。无匹配署名时在提交前记录本次歌曲及字段 |
| 浏览器工作台 | 4 项界面与桥接测试通过。新批执行过程中上一批结果收起，运行结束后显示当前结果 |
| 番茄与任务回归 | 随包 Electron 的 Node 模式 95 项、无头番茄适配器 31 项、番茄计划 18 项、艺人创建和任务 39 项、基础 3 项通过 |
| Windows 构建 | TypeScript 和浏览器入口的 `-BuildOnly` 通过，包含 Main、preload、Core 和渲染产物 |

相关回归位于 `tests/fanqie-downloads.test.mjs`、`tests/fanqie-directory-catalog.test.mjs`、`tests/fanqie-directory-form.test.mjs` 和 `tests/platform-management-ui.test.mjs`。

浏览器版从原 `Start-Rainfall-Browser.bat` 入口构建加载。真实账号投稿、签约和 Windows 原生窗口待验收。当前用户目录无已验收桌面交付指针，桌面入口切换依 `docs/release/desktop-delivery-policy.md` 执行。

## 回退

撤回本轮上述源码和测试差异后重新构建。既有目录扫描结果、批次记录和官方回执继续按原格式读取，数据库无需迁移。
