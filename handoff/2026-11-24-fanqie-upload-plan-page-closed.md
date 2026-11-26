# 2026-11-24 番茄上传计划运行排查与页面关闭诊断

## 结论

按用户指定入口 `Start-Rainfall-Browser.bat` 启动了浏览器预览，并从计划中心查看“番茄音乐平台上传”的最近执行记录。当前可读取的浏览器开发库中，关联账号为“素素”，批次扫描发现 77 首、其中 76 首可用。失败发生在官网作品目录的批量查重读取阶段：`catalog:batch-lookup` 返回 `FANQIE_BROWSER_OPERATION_FAILED`，截图状态为 `page-closed`。该运行未进入歌曲表单上传；批次记录中 76 首仍为 queued，未读取到这次运行的上传回执。

这说明本次失败的直接原因是番茄工作页面在目录读取期间关闭，不能从现有证据断言页面为何关闭（例如用户关闭、站点脚本关闭或浏览器会话异常），也不能代表其他运行的普遍原因。计划有 29 条历史记录，早期曾在不同阶段失败，因此这些故障需分开诊断。

## 修改

- 新增 `src/main/fanqie/browser-errors.ts`，统一识别 Playwright 的 page/context/browser closed 错误。
- `src/main/fanqie/catalog-session.ts` 将页面关闭错误归类为 `FANQIE_BROWSER_PAGE_CLOSED`，向界面提供“工作页面已关闭、自动化已暂停；重开窗口并先核对日志和官网回执”的提示。
- `src/main/fanqie/directory-trace.ts` 的阶段日志使用同一错误分类，让 `catalog:batch-lookup` 记录可以直接指出页面关闭，而不再只显示通用操作失败。
- `handoff/PROJECT-HANDOFF.md` 同步本次结论及证据边界。

## 影响与验证

该变更只改善番茄自动化错误归类与提示，不会自动重试、重新上传或改变已提交作品。运行记录来自 `rainfall-studio-browser-dev\\data`，不是已验证桌面指针确认的生产数据根；当前用户配置下找不到 `verified-desktop.json`，因此本次不能把该开发库记录当作生产桌面运行证明。

执行前按用户指定的 `Start-Rainfall-Browser.bat` 无参数启动，构建日志显示应用构建和浏览器预览启动成功。之后只查看执行记录、批次状态和脱敏 trace，没有重跑计划或提交歌曲。此次代码修改后未运行测试或构建；Windows 原生验收未做。

## 后续与回退

后续如需再次运行，先重新打开已绑定的番茄工作窗口，检查准确的歌曲清单、账号和番茄官网回执，避免重放 76 首。页面关闭时先据 trace 确认失败阶段；若在提交阶段发生关闭，应按“结果未知”核对官网，不得直接自动重试。回退时撤销本文件所述 helper、两个调用点和错误提示，再恢复本交接记录。
