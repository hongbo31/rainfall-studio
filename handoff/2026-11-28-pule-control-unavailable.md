# 谱乐 AI 创作控件未出现

## 证据与原因

任务附件只显示阶段结果“提交音乐生成 · 失败 · `PULE_CONTROL_UNAVAILABLE`”，没有本次页面 trace 或错误截图，无法从这份记录断定具体缺失了哪个控件。当前代码里该通用错误可能来自自定义模式页签、表单字段、纯音乐开关或生成按钮。

上一条用户截图的谱乐 `/create` 页面只显示放大的首页图标。账户窗口显示恢复只加在账号管理打开路径，而 Plan Center 音乐任务会另开一个隔离页并直接导航 `/create`，原先没有调用恢复。页面未完成渲染时，已登录态仍可能成立，但自定义模式页签无法出现，等待 45 秒后就会返回通用控件错误。

任务附件显示状态为“失败”。`src/main/plan-pule.ts` 只在生成按钮点击前即将发送时标记 `paid=true`，并根据该值决定记为 `failed` 还是 `unknown`；因此这次失败发生在提交前，没有按该任务记录到谱乐生成请求。按钮文案“重试（按服务计费）”指成功重试会产生新计费，不表示上一条失败已收费。

## 修改与影响

- `src/main/pule-page-recovery.ts` 将谱乐显示恢复做成共享 helper。账户窗口与生成任务页在导航 `/create` 后都会将缩放复位；先给页面 12 秒完成 SPA 渲染，仍找不到创作区、自定义模式页签及交互控件时，才临时绕过缓存和 Service Worker 重载一次，再等待 12 秒。不会清 Cookie 或 Local Storage，不刷新已正常显示的表单，也不把窗口切到前台。
- `src/main/pule-browser-page.ts` 在每次进入创作页后只运行一次恢复；若等待自定义模式仍失败，记录 `PULE_CREATE_TAB_UNAVAILABLE`。表单、歌名、歌词、风格、纯音乐开关和生成按钮分别返回对应控件错误码，便于区分下次失败阶段。通用错误不再固定使用 `PULE_CONTROL_UNAVAILABLE`。
- `src/renderer/components/PuleBrowserGeneration.tsx` 为新增控件错误码添加了中文提示。历史 `PULE_CONTROL_UNAVAILABLE` 记录继续兼容。

## 验证与限制

- 完成源码静态检查与 `git diff --check`；未运行自动化测试、构建、真实登录窗口或生成任务。
- `tsc --noEmit` 未通过，报错均在本轮未改动的番茄、远控、苏诺和任务标签文件，且缺少 `reflect-metadata`、`@peculiar/x509`、`qrcode-generator` 依赖；本轮变更文件没有类型诊断。
- 任务资料根的 `verified-desktop.json` 缺失，没有读取生产任务日志、检查真实账号浏览器资料或更新已安装客户端。
- 当前附件没有 trace，无法确认这次实际缺失的表单控件；修改只作用于之后的运行，不会重放或改变已失败的任务。首次真实重试仍应由用户核对任务中心状态并确认本次会产生新的服务调用。

## 回退

回退 `pule-page-recovery.ts` 的共享调用、恢复 `pule-browser-page.ts` 的通用控件错误、移除 `PuleBrowserGeneration.tsx` 的新增文案，并删除本文件及 `PROJECT-HANDOFF.md` 对应条目。
