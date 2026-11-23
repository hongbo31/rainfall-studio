# 番茄目录上传超时

2026-11-23，北京时间。RF-008 由 xb 核对现场日志并修改执行器，backend 核对超时边界和任务停止接线，qa 复现慢回显并验证等待边界。

## 现场

任务中心 12:57 启动的「谱乐每日任务」第三项「番茄音乐平台上传」于 14:02 报「等待上传确认超时，请查看该歌曲的执行日志」。浏览器库保留的关联计划及批次 `trace.jsonl` 通过只读方式核对。第一轮前 16 首有音频上传回显，第 17 首于 13:59:53.818 进入 `upload:audio`，于 14:02:01.005 记录 `FANQIE_UPLOAD_READBACK_TIMEOUT`。当轮停在点击「确认上传」之前，批次回执计数为 0。

原执行器选择文件后最多等 120 秒读取上传回显。现场证据能确认本地等待到期，真实网络传输和平台处理各自占用的时间待确认。

## 改动

- 目录上传逐首等待音频官网回显，单首上限由 2 分钟提高至 10 分钟。有效回显到达就继续，官网明确报错或回显文件不匹配时立即走现有失败处理。授权前仍核对表单及作品回执。[音频等待](../src/main/fanqie/directory-form.ts#L374)
- 任务或计划启动的目录上传，在等音频时通过现有 Core 接口定期检查停止状态，检查间隔为 2 秒。停止后保留已记录的上传意图供核对，父子执行进入停止状态。[目录执行器](../src/main/fanqie/directory-run.ts#L490) · [Core 停止回归](../tests/fanqie-downloads.test.mjs#L981)
- 变更适用于平台管理、计划中心及任务中心使用的目录上传。浏览器和 Windows 客户端共用 Main 实现，继续读取原有作品、配置及执行日志格式。

## 验证与交付

- 旧版执行器复现 120 秒后提早报错。无头目录表单 33 项通过，覆盖晚到的有效回显、等待第 590 秒仍继续、第 600 秒到期、停止和确认只点击一次。用同版本 Windows Electron 的 Node 模式复跑四项音频回归，全部通过。[表单用例](../tests/fanqie-directory-form.test.mjs#L338) · [模拟官网](../tests/fixtures/fanqie-directory-site.mjs)
- 目录批次与任务回归 71 项、目录回执与艺人查询 6 项、Windows Electron Node 模式基础回归 95 项、模拟番茄适配器与授权 31 项通过。
- TypeScript 检查和原浏览器入口的 `-BuildOnly` 通过。隔离构建产物含 Main、preload、Core、renderer，两处运行文件的 SHA-256 与工作区一致。验证日志放在仓库同级构建目录 `../rainfall-studio-build/verification/rf008-aa7c2d5e`，分别为 `ten-minute-baseline.log`、`headless-directory-form.log`、`electron-directory-audio.log`、`directory-and-task.log`、`headless-catalog.log`、`native-runtime.log`、`typecheck.log`、`browser-build.log`。

真实慢网投稿与 Windows 原生窗口待验收。现有浏览器会话仍使用启动时的快照，下次从 `Start-Rainfall-Browser.bat` 启动会构建本轮源码。本轮交付为源码及隔离构建。需要回退时撤回上文两处运行文件中 RF-008 的差异和三处对应测试改动，再用原入口构建。
