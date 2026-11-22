# 番茄音乐目录上传文件控件

## 原因和改动

现场批次日志在第 1 首的 `upload:audio` 记录了 `FANQIE_FILE_CHOOSER_SCOPE_CHANGED`，当时还未送入文件。官网收到上传区点击后，会在主页面的 `body` 下创建并打开临时文件输入框。旧版只允许歌曲卡片内的已挂载输入框，因此拒绝了该选择器。[番茄成品发行表单](https://www.novelfm.com/creator/music/finished/ugc/uploadProduct)

- `src/main/fanqie/directory-files.ts` 和 `directory-form.ts` 用当前歌曲编号和字段 ID 定位音频、歌词、封面和版权证明。临时输入框须由该控件的本次点击打开，且接受的文件类型须与字段一致。版权证明点上传图标，绕开同一区域内的材料指南链接。
- 音频、歌词和版权证明按当前字段内的回执行核对文件名、类型和大小。封面确认裁剪后等上传状态消失、预览加载完成。依账号管理配置上传版权证明，纯音乐的歌词规则沿用现有设置。
- `src/core/fanqie-downloads.ts` 和 `src/shared/fanqie-downloads.ts` 将 ZIP、BMP 加入版权证明格式，支持官网允许的最大 200 MB。执行窗口显示选择器归属、传输和回执错误的具体提示。
- `src/main/fanqie/directory-trace.ts` 识别版权证明的 `authorizationFiles` 字段和共享上传组件的可见错误，沿用按歌曲编号记录的脱敏截图。

## 验证

- 更新 `tests/fanqie-directory-form.test.mjs` 和对应表单模拟页。旧版复现现场错误，修复后在无头 Chromium 中逐一核对两首歌曲八份材料的 SHA-256 和字段。验证封面上传失败会暂停，旧选择器或其他字段的选择器不会收到文件，整批只有一次模拟确认。用官网的共享文件选择器实现替换模拟选择器后，同一双歌曲场景通过。测试网络请求由本地拦截。
- `tests/fanqie-downloads.test.mjs` 覆盖 ZIP、BMP 和 200 MB 边界。`tests/fanqie-authorization.test.mjs` 校验第二首版权证明失败的字段、歌曲编号和截图。目录相关 25 项和番茄回归 116 项通过，TypeScript 检查通过。
- 浏览器预览与 Windows 客户端共用 Main 上传逻辑。原浏览器入口的仅构建流程通过，Windows Electron 的后台本地桥接验证了选择器错误提示和投稿核对按钮。真实账号上传及 Windows 原生窗口待验收。正式桌面入口和作品库保留。

## 接续和回退

上次批次若仍显示「需核对投稿」，先在番茄账号工作标签页确认旧表单的状态，回到创作首页后在 Rainfall 点「核对投稿状态」。核对完成后重新扫描并执行待上传歌曲。浏览器使用仓库原入口 `Start-Rainfall-Browser.bat`。需要回退时，撤销以上源码及测试的本次改动，保留批次日志和资料。
