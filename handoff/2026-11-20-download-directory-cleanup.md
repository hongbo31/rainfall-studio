# 配置中心精简下载目录

2026-11-20

## 改动与影响

按截图移除「无发布目标时的音乐人账号」下拉框，以及「任务请求」和「素材 / 生成结果」两个页签及其内容。「目录与收件」改名为「下载目录」，页面保留下载位置的显示、选择和清除。

- 配置中心和下载设置见 src/renderer/pages/ConfigurationCenter.tsx、src/renderer/components/DownloadArchiveSettings.tsx。移除 src/renderer/components/DirectoryTaskSettings.tsx 和对应样式。
- 首次使用引导与素材计划表单同步移除任务目录绑定入口。计划缺少下载位置时可以直达「下载目录」，账号不可用时可以直达「账号管理」。见 src/renderer/components/FirstSetup.tsx、src/renderer/pages/PlanCenter.tsx、src/renderer/components/CreationWorkspace.tsx、src/renderer/ui-system.css。
- 常规运行已停用目录任务的自动扫描与新请求派发，旧绑定和请求记录供回读。既有 dot 计划通过已配置的交付通道接收素材。见 src/core/studio.ts。
- 旧版保存的有效归档账号可供旧计划使用。旧账号已被删除时，归档可采用唯一的默认发布账号。见 src/core/download-archive.ts。
- 计划运行过程、手动下载和变更目录后的处理见 [统一下载目录与逐轮优化歌词](2026-11-20-download-directory-and-lyric-iterations.md)。

## 验证

- 浏览器版使用构建后的本地服务和隔离 SQLite 库运行。下载目录页只显示下载位置、选择和清除操作。先前保存的下载位置可见，清除后刷新仍为空，目录中的测试文件可读。
- 浏览器和 Windows 客户端共用的 Main、Core、预加载及渲染层已通过后台构建，TypeScript 检查通过。真实的原生窗口、文件夹选择器和正式桌面包待验收。
- 计划、配置中心、下载归档和基础回归共 28 项通过，含选择及清除目录的夹具回归。集成回归 230 项通过，覆盖旧目录绑定在正常调度时保持空闲。另有三项在改动前同样失败，分别是隔离检出缺少外部 100 首素材，以及两项腾讯待授权测试的目标平台数断言。
- 当前回归见 tests/plan-workflow-ui.test.mjs、tests/configuration-ui.test.mjs、tests/download-archive.test.mjs、tests/integration/studio.test.cjs。scripts/test-plan-directory-ux.mjs 与 scripts/test-provider-directory-ui.mjs 记录旧版目录任务界面的验收路径。

## 使用与回退

浏览器版从现有的 Start-Rainfall-Browser.bat 启动时加载新界面。需要回退时，仅撤回本页列出的本轮改动并重新构建。返回旧版时，原来启用的目录任务会随旧版客户端继续调度。
