# 任务中心主唱校验与苏诺之音回执处理

2026-11-23

## 本次执行

「苏诺之音每日任务」08:29:12 手动运行，首个计划为「苏诺之音_东北土嗨曲」。作词正常完成，歌曲「兜里还剩几个子儿」在 08:31:25 进入提交阶段，约 3.8 秒后记录为 `WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN`。本轮没有写入两首曲目的回执或 WAV 哈希，后续七个关联计划因此一直排队。

这次和同计划此前三次报错都选用男声，同时 AI 生成的风格明确写了女声。当前记录中的用词是「女声旋律性唱腔」。同计划 01:02 提交成功的批次中，所选男声与风格描述一致。官网创作逻辑会在发送创作请求前拦住明确的人声冲突。旧执行器在点击「创作」前已标记可能扣费，后续把预检拦截和真正掉回执归成同一条提示。历史执行缺少现场弹窗和原始错误记录，排查依据是实际输入、本地时间线与官网提交规则。[官网创作页提交逻辑](https://www.suno.cn/home/assets/CreatePcPage-mq81okMr.js)

## 改动

- `src/core/lyric-writing.ts` 向计划作词模型明确传达本轮主唱。 `src/core/plan-workflow.ts` 在苏诺之音和谱乐的网页节点提交前修正明确冲突的正向主唱描述，保留原作词稿、歌词、标题及排除条件。
- `src/main/suno-cn-browser-page.ts` 区分官网的主唱冲突和积分不足预检。 `src/shared/pule-browser.ts`、`src/main/plan-pule.ts`、`src/main/pule-browser.ts` 按明确的拦截原因结束本轮。网页中断、等待原结果和 WAV 下载失败使用相应原因。
- `src/shared/plan-pule.ts`、`src/main/plan-pule.ts`、`src/core/plan-pule.ts` 在确认两首原作品后保存回执，每成功保存一份 WAV 再写入其哈希。完整 WAV 在窗口中断后可继续归档。 `src/core/plan-center/index.ts` 恢复中断时已保存齐的 WAV，归档前按原哈希校验文件。
- `src/core/publication-task-integration.ts` 让缺少回执或 WAV 的苏诺之音创作计划结束占用，下一独立计划继续调度。原执行记录保留核对依据。谱乐仍按已记录的对应账号和原歌曲 ID 自动核对，核对结束后同样释放后续计划。 `src/renderer/plan-execution-labels.ts` 和 `PuleBrowserGeneration.tsx` 展示具体原因。

## 验证与回退

- 119 项计划、任务调度和 AI 作词测试、90 项苏诺之音及谱乐浏览器测试、3 项任务与平台管理无头界面测试通过。其中定向回归覆盖两家网页提交的主唱一致性、苏诺之音预检拦截、原始 WAV 持久化和重启归档，以及缺少旧回执时继续后续计划。
- TypeScript 检查和 `Start-Rainfall-Browser.bat -BuildOnly` 通过。浏览器与 Windows 共用新版执行代码，主进程、预加载、Core 和渲染层构建文件齐全。
- 真实预览库用于只读定位。回归使用模拟官网页面和隔离数据。真实账号和 Windows 原生窗口待验收。启动新版后，08:29 的旧执行仍保留原提交记录，任务中心可以继续调度它的后续计划。
- 回退时撤回本轮源码和测试，再用原浏览器入口重建。回执和音频哈希写入现有执行记录格式。
