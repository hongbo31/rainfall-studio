# 腾讯音乐人草稿工作台本地 MVP 验证

日期：2026-10-16。主机：SOURCE_WINDOWS_HOST。分支：`feature/tme-draft-mvp`，基线 `f6b2e08`。仅本地提交，不推送、不制作或替换安装包，不修改用户现有客户端或数据库。

## 已完成范围

发布中心 → 腾讯音乐人草稿通道：作品/本地账号备注选择，音频/封面/证明导入入口，作者与 AI 信息显式填写，原歌词保留、已知独立标签清理与差异预览，五项确认绑定资料快照。本地任务持久化、附件检查点、失败阻断、账号隔离、去重及远端状态展示已实现。

Main 层提供浏览器适配器、严格 IPC 与一次性短时授权，执行时复核身份与资料。远端已提交、驳回或已发布作品仅回读，不覆盖或重提。当前生产页面契约未校准，真实上传被禁用；不存在提交审核接口。高级 CDP 设置只能连接事先已启用的授权本机端点，客户端仍缺日常用户的首次连接路线，详见 [连接调查](../integrations/tencent-browser-connection.md)。

## 最终执行结果

| 检查 | 结果 | 本地证据（output 与日志不入 Git） |
| --- | --- | --- |
| `npm run test:tme`，含桌面构建 | 32/32，通过 | `output-tme-final.log` |
| `npm run typecheck` | 通过 | `output-typecheck-final.log` |
| `npm test` | 3/3，通过 | `output-base-final.log` |
| `node scripts/test-headless.mjs` | 131/131，通过 | `output-core-final.log` |
| `node scripts/test-inbox-unit.mjs --regression` | 42/42，通过 | `output-inbox-final.log` |
| `node scripts/tme-fixture-browser.mjs` | 独立临时 Chrome 本地表单通过 | `output/playwright/tme-fixture-fd9689e6-8cfc-4a14-a954-e370e9ae2189/report.json` |
| `node scripts/tme-desktop-qa.mjs` | 隔离 Electron 界面、持久化与保护检查通过 | `output/playwright/tme-desktop-9af0b6e5-485d-467a-afc2-190f96fab18f/report.json` |

浏览器 fixture 在本地 HTML 使用合成附件，验证填表、每类附件一次、保存一次与重复运行不重存；拦截 HTTP/HTTPS。它使用测试专用身份和 DOM 标记，不是腾讯实站测试。

Electron QA 使用独立数据根、合成短音频和本地占位封面/证明文件，验证初始作者/AI 未确认、清理保留原文、资料确认、等待真实账号任务、禁用实际上传及重启持久化；renderer 错误和被观察 Electron 网络请求均为空。此观察不等于整机抓包证明。原桌面快捷方式、管理指针及原数据库哈希保持一致。测试只关闭其自身创建的进程。

视觉验收已查看 `metadata-preview.png` 和 `draft-status.png`：深色暖紫工作台，表单/预览和任务状态可辨，常驻播放器保持，缺乏授权连接时上传按钮禁用。截图同在上述 Electron QA 目录，另有 `studio-full.png`。

## 审查及修复

一次独立实现审查发现三个 Important 问题，均先补失败反例再修复并通过：

1. 阻断任务重新预检可能丢失身份/附件证据：保留已发生外部动作的任务，禁止重置证据。
2. 保存超时且暂时未读到远端草稿时可能二次保存：保持待核对，未完成远端对账前禁止再次保存。
3. 表单逐项填写时页面身份变化未充分阻止写入：每次字段、附件及保存动作前重新核对完整身份。

真实 Electron 验收另暴露检查 IPC 返回格式不匹配，已用失败测试固定统一结果封装，拒绝伪造和过期请求。最终回归在这些修复及 `noDefaults` 设置之后执行。

## 尚未完成的实站事项

- 用户现有 Chrome 已登录，仅只读观察到腾讯首页；未进入上传表单，未验证账号 ID、权限、授权模式选项和实际草稿语义。
- 尚未安装/连接官方扩展桥；当前会话没有可用的浏览器/IAB 控制 MCP。不能把高级 CDP 字段视为已完成首次连接方案。
- 腾讯真实字段、附件规格、成功/失败回执、远端草稿定位与重入路径仍需校准。fixture 的附件属性不是实站选择器。证明文件需按真实规格处理其名称/MIME，不能以本地 `.bin` 受管路径直接承诺可上传。
- 未选择首个正式试传作品、音频/封面/证明、作者和 AI 信息，也未确认该次授权模式。不会生成虚假证明或自动推断著作权。
- 原《那天刚好下雨》的人工改名和驳回处理归用户，本次未改动或重提，也未猜新歌名。

真实上传 **0**，真实草稿保存 **0**，提交审核 **0**。本地 fixture 成功不代表真实腾讯上传成功。

## 在独立数据根运行源码

需要仓库已装依赖及 Node/Electron 环境。PowerShell 7：

```powershell
$env:RAINFALL_DATA_ROOT = Join-Path $env:TEMP 'RainfallStudio-TmeManualQA'
npm.cmd run desktop:dev
```

保持同一数据根重启可观察持久化；不要指向日常用户库，不要同时启动两个实例访问同一库。在“发布中心”进入“腾讯音乐人草稿通道”。本阶段可验证本地流程；真实页面未校准时写入按钮保持禁用。
