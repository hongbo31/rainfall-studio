# AI作词灵感模式

## 改动与影响

- `src/renderer/pages/LyricWriting.tsx` 将「输入灵感」更名为「灵感模式」，移除手填创作灵感。先选发布平台，再选兼容账号和该账号下的艺人。切换平台或账号后清空下游选择和计费确认。
- `src/renderer/components/LyricInspirationArtist.tsx` 读取已选艺人的档案和创作默认值，按档案实际填写的字段展示资料，并带出第二歌手和关联的提示词模板。发布平台和账号映射沿用现有目录。选择没有账号或艺人的平台时可进入账号管理。
- `src/shared/lyric-writing.ts`、`src/core/studio.ts` 和 `src/core/lyric-writing.ts` 增加独立的灵感任务。校验平台与账号匹配、艺人归属和资料版本。所选文本 API 生成两个候选歌名和一份灵感，并单独评分，最多调用两次。模型使用平台名称和已保存的创作偏好及提示词模板，账号备注和签约资料留在本机。
- 生成并评分完成后，结果页只显示「歌名 1」「歌名 2」「灵感内容」，可从历史重新打开。原有「按艺人信息」作词、计划作词和既有作词记录继续走各自原流程。`src/renderer/creation-workspace.css` 适配平台、账号和艺人选择器的换行。
- `src/core/database.ts` 增加 `inspirationJobs` 表，兼容旧库并隔离旧版作词队列。`src/core/backup.ts` 在还原备份时冻结待执行和执行中的灵感任务。已完成的灵感可继续查看。

## 验证

- `tests/lyric-writing-ui.test.mjs` 使用无头 Chromium 验证番茄音乐和 QQ 音乐、切换账号后清空艺人和授权、显示档案中的额外字段、提交和重开三个结果字段。
- `tests/lyric-writing.test.mjs` 验证跨平台和跨账号选择拒绝、过期资料拒绝、同一请求幂等、创作数据取值、评分关联和低分后结束。兼容测试验证纯音乐计划保留三项上游输出，以及后续音乐流程。
- 基础、浏览器桥接、账号管理、创作中心、AI作词和计划工作流回归共 44 项通过。TypeScript 检查及 `Start-Rainfall-Browser.bat -BuildOnly` 构建通过，包含 Windows Main、预加载、Core 和共享渲染层。
- 通过随包 Electron 44.7.2 的 Node 模式，在同级构建目录 `lyric-inspiration-c81cf51a` 验证实际 Core 调用、结果持久化和备份恢复。真实模型调用和 Windows 原生窗口验收待执行。

## 后续与回退

下次通过同一个 `Start-Rainfall-Browser.bat` 打开浏览器工作台时会构建新版。桌面入口按原生验收流程切换。回退时撤销本轮源码和测试改动，保留数据库及 `inspirationJobs` 表。旧版仍可读既有作词记录，新版灵感记录可在重新安装新版后查看。
