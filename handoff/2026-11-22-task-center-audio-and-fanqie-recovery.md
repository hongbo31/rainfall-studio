# 任务中心原音频下载和番茄队列修复

2026-11-22

## 现场记录

- 16:23 启动的「素素每日任务」完成了「日常」的第一轮。第二轮已取得两首谱乐歌曲的回执。计划的原始 WAV 在通过文件头检查后命中 50 MiB 上限，记录为 `PULE_AUDIO_SIZE`。谱乐浏览器接收 WAV 的上限是 80 MiB。现场归档中已有约 272 秒、52.31 MB 的 48 kHz 立体声 WAV，接近旧界限。失败文件的临时副本已由下载流程回收。
- 「素素每日任务」已记录「日常」失败，并开始等待第二项。12:32 留下的「番茄音乐平台上传」执行仍占用同一计划。旧批次的 14 份上传日志均停在 `opening-form`，断连发生在 `validate-songs`。账号和批次对应，作品回执及签约记录均为空。旧调度只识别一种文件回收失败的收尾条件，无法释放这次上传前断连。
- 16:23 启动的「素素任务2」已识别出两首苏诺之音歌曲。记录只有配对回执，暂无暂存 WAV。旧代码把确认歌曲后发生的异常写成 `WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN`，上层因此一直等待。旧记录只保存了通用码，无法追溯当次是在改名、准备 WAV 还是传输阶段发生异常。

## 改动与影响

- `src/shared/plan-pule.ts` 让计划导入、Core 校验及苏诺 WAV 暂存读取共用已有的 80 MiB 浏览器接收上限。谱乐的原始 WAV 按回执绑定，文件格式和体积校验继续生效。已有失败执行中的「重试此阶段」可凭原曲回执补下载。
- `src/core/plan-fanqie-directory.ts` 根据账号目录的批次和逐首日志判定断连发生在提交前。`src/core/publication-task-integration.ts` 在创建新执行的事务内收尾可确认的旧失败，保留原日志。新番茄执行沿用原有的作品查重、回执核对和签约确认。共用同一发布计划的任务按各自执行 ID 排队。
- `src/main/suno-cn-browser-page.ts` 在已准备好的 WAV 仍未启动下载时，核对当前歌曲并在原有等待时限内重试一次下载。`src/main/plan-pule.ts` 保留确认后的原回执、已保存文件的校验值和具体错误。对于已有确切配对回执但下载失败的纯生成计划，任务中心记录失败并移到下一个计划。生成归属仍待核对的记录继续显示待处理。`src/renderer/plan-execution-labels.ts` 显示相应的问题位置。
- `tests/pule-browser.test.mjs`、`tests/suno-cn-browser.test.mjs`、`tests/fixtures/suno-cn-browser.html`、`tests/plan-workflow-refactor.test.mjs`、`tests/publication-tasks.test.mjs` 和 `tests/fanqie-plan-checkpoint.test.mjs` 覆盖大小边界、原曲重试、部分 WAV 回执及新旧任务衔接。`tests/plan-fanqie.test.cjs` 更新了重启用例的数据库查询替身，以匹配当前按前缀读取的接口。

## 验证与交付

- 只读读取两条任务及其原上传日志，在内存库复测。原「素素每日任务」进入第 2 项番茄上传。模拟该执行完成后，原「素素任务2」取得自己的番茄执行 ID。它的两首苏诺歌曲回执留在原记录中。
- 84 项谱乐和苏诺无头浏览器测试通过，包括 275 秒 WAV 导入、超过 80 MiB 的拒绝、首个下载事件缺失后补下载。Windows Electron Node 模式复测 6 项通过。计划中心和完整流水线 36 项通过。
- 147 项任务、工作流、番茄目录和归档回归通过，番茄计划专项 18 项通过。覆盖新计划接续、上传回执保留、旧签约状态和断连前后的边界。
- 原 `Start-Rainfall-Browser.bat -BuildOnly`、TypeScript 及 Main、preload、Core 和渲染构建通过。浏览器工作台和两端共用的计划与任务页面 5 项通过。
- 验证均在隔离环境中进行。真实网站下载、上传和 Windows 原生窗口待验收。浏览器版通过原启动入口重新加载后，由新版调度接续现有任务。Windows 桌面快捷方式的切换按 `docs/release/desktop-delivery-policy.md` 的验收流程执行。

## 回退

撤回上述源码和测试变更后从原入口重建。计划和历史回执沿用同一数据格式。发生过的外部提交和归档保留在各自原执行中。
