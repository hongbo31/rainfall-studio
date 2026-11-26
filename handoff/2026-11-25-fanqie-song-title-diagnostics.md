# 番茄封面失败歌名与执行日志直开

## 改动

- `src/main/fanqie/directory-form.ts`：歌曲相关 trace 的 begin/ok/error 事件增加歌曲名称；字段校验和纯音乐跳过项也写入标题。
- `src/main/fanqie/directory-trace.ts`：安全写入经过控制字符清理、限长的 `songTitle` 到 trace details。
- `src/renderer/components/FanqieDownloadUpload.tsx`：封面预览错误在歌曲项目下显示具体歌名；批次错误区域显示待核对歌曲名称列表。
- `src/shared/fanqie-downloads.ts`：封面预览错误提示明确日志中包含歌名、序号和截图。
- `src/main/fanqie/directory-run.ts`、`src/main/bootstrap.ts`、`src/core/plan-fanqie-directory.ts`：平台管理和计划中心的“打开执行日志”改为直接打开该批 `trace.jsonl`，日志路径仍由账号/计划范围计算并校验。

## 验证与边界

- 本轮浏览器候选构建通过；未启动客户端、未打开真实账号，未运行测试。
- 新生成的日志会带有歌名；已有日志不会被补写标题。截图仍保留在该批目录的 `screenshots` 子目录，trace 条目记录相对路径。

## 回退

还原上述文件中 `songTitle` trace details、封面错误标题展示，以及 `openDiagnostics` 改为打开 `trace.jsonl` 的改动即可。
