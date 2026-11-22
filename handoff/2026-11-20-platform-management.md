# 平台管理与谱乐 AI 创作入口

2026-11-20

## 改动与影响

- 侧栏在「AI作词」下方新增「平台管理」。原「上传并发布」列出的网易云音乐、汽水音乐、QQ 音乐、酷狗音乐、抖音视频和番茄音乐集中在这里，可查看工作流支持状态、设置默认发布账号或进入账号管理。见 src/renderer/main.tsx、src/renderer/pages/PlatformManagement.tsx 和 src/renderer/platform-management.css。
- 新建发布任务可选择当前支持工作流的三个目标，番茄音乐、QQ 音乐和酷狗音乐。勾选时带入默认账号，可为该任务另选账号。已保存任务读取自己指定的平台和账号。番茄账号核对及本次授权仍在任务中确认。见 src/renderer/components/PublicationTaskEditor.tsx、src/renderer/publication-tasks.css 和 src/shared/publication-tasks.ts。
- 「歌曲生成」提供谱乐 AI 专用入口。卡片右上角「打开页面」使用所选谱乐账号，「执行」打开右侧制作面板。各平台的操作和验证见[卡片页面与执行](./2026-11-20-platform-card-actions.md)。

## 验证

- 浏览器预览使用隔离的 SQLite 库及构建后的本地服务。验证了六个平台、默认账号保存和刷新、宽度 1000 像素下的卡片排版，以及谱乐 AI 入口可见。
- 18 项定向回归通过。无头夹具验证谱乐按钮发出的官网导航请求、默认账号和旧任务指定账号、新任务的目标及番茄核对。主程序 TypeScript、Windows Main、Core、预加载和两端共用渲染层均通过后台构建。
- 集成回归 230 项通过。同前一轮相比，仍有三项失败，分别是隔离检出缺少外部 100 首素材及两项腾讯待授权测试的目标平台数量断言。Windows 原生窗口、正式桌面包和谱乐实际生成待验收。

## 使用与回退

浏览器版从现有的 Start-Rainfall-Browser.bat 启动后加载新模块。需要回退时，撤回上述源码改动及 tests/platform-management-ui.test.mjs，再用同一入口构建。平台默认账号可在账号管理中读取和修改，任务记录使用原有存储格式。
