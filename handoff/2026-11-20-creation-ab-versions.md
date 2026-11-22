# 创作中心作品的 A/B 试听、歌名与封面

日期：2026-11-20

## 改动

- 创作中心将「本地作品」改为「作品」，同一首作品下面列出可用的 A/B 录音。点击试听会直接播放所选音频，播放器显示该版歌名。搜索同时匹配两个歌名。
- AI 作词的「快速生成」同时传入歌名一、歌名二。A 使用歌名一，B 使用歌名二。没有单独的 B 版歌名时沿用 A 版歌名。可在作品详情补填或清空 B 版歌名。
- A、B 封面分别保存和导入，拒绝关联同一张图片。新创作任务启用音乐和封面生成时，按实际返回的音频版本请求封面，两版齐全才请求两张。只有 B 时用 B 版歌名出一张。API 两次出图的计费提示在创建任务前展示。已有任务按原授权执行，已有 A 封面和旧作品数据保留。手动收图按版本和任务区分，不会顶掉正在出图的计划请求。

## 涉及文件与兼容性

- 界面和播放器：`src/renderer/components/CreationWorkspace.tsx`、`CoverInbox.tsx`、`src/renderer/pages/LyricWriting.tsx`、`Track.tsx`、`CoverStudio.tsx`、`Library.tsx`、`src/renderer/main.tsx`、`context.tsx`、`creation-workspace.css`。
- 创作草稿与作品元数据：`src/shared/work-versions.ts`、`generation-config.ts`、`plan-pule.ts`、`schemas.ts`、`src/core/creation-tasks.ts`、`plan-workflow.ts`。
- 封面导入、任务、回执与归档：`src/shared/cover-handoff.ts`、`src/core/assets.ts`、`studio.ts`、`cover-handoff.ts`、`cover-inbox.ts`、`plan-center-integration.ts`、`download-archive.ts`、`src/main/bootstrap.ts`。数据库 schema 版本未变；已有作品可直接读取。旧作品未保存歌名二时可从详情补填，无需重新生成音频。
- 验证增加了 `tests/version-covers.test.mjs` 的独立封面及回执测试，并同步更新创作草稿和创作中心渲染断言。

## 验证与交付

- 浏览器和 Windows 客户端共用的 React 渲染层、Main、Core 和预加载已成功后台构建。TypeScript 检查、33 项相关测试和 34 项隔离兼容测试通过。
- 无头浏览器从「作品」直接播放两段不同的本地测试音频，核对 A/B 播放器歌名、旧作品同名回退、B 版搜索、补 B 封面后 A 封面保留、AI 作词双歌名绑定和双封面请求标记。实际封面回执与独立入库在隔离 SQLite 和样本图上验证。
- 未打开 Windows 原生窗口，未进行正式桌面包验收或更新快捷方式。未触发真实 API 生成、发布或已有任务重跑。此轮调整创作中心的试听和封面管理，正式发布环节的版本规则沿用现有流程。
- 浏览器版可用原有 `Start-Rainfall-Browser.bat` 重新启动。若需回退，只撤回本轮代码并按桌面交付规范使用上一已验证运行包与对应备份。旧版的计划解析器可能不识别新版任务中的可选字段，回退前应备份分别保留新版库和旧版可读快照。
