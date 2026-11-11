# Rainfall Studio 0.11.1-preview.1

独立 Windows 便携候选；未安装、未替换桌面快捷方式或正式版本指针。只在本项目新目录构建，默认使用候选目录自己的 `candidate-data`。本阶段未启动桌面窗口。

专辑执行链的具体生产限制见 [交付状态](../acceptance/2026-10-19-album-service-status.md)。现有计划、原 YourMusic 路径、A/B 素材、dot 接收和原统一发布链继续保留。本次补齐已发行/未发行专辑目录逐页读取及待发布歌曲引用的游标滚动分页；其他平台专辑适配在界面及公开执行入口明确禁用。

## 本地构建及验证

另补齐纯歌词/封面改写后的本地工作室恢复入口、cover/materials 重试，并修正浏览器连接与登录快照的区别。跨版本兼容验证使用真实旧版 Core 创建的合成库及独立进程；未拿隔离结果冒充原库迁移、真实生成或原生桌面验收。当前完整交付状态见 [逐项清单](../acceptance/2026-10-19-end-to-end-checklist.md) 与 [登录态审计](../acceptance/2026-10-19-login-session-reuse.md)。

使用已有 Node、Electron 与 node_modules；不安装软件、不下载依赖。

```powershell
node scripts/build-desktop.mjs
node scripts/verify-album-service.mjs
node scripts/package-tme-candidate.mjs --album-service
```

完整验收结果保存于 `output/album-integration/final-verification/report.json`。其中 SQLite 相关脚本由 runner 使用 Electron 的 Node 模式运行；不是启动桌面客户端。专项浏览器全部无头，平台请求全部由夹具截获。

打包脚本输出实际候选目录及 manifest，其中包含提交哈希。将整个目录保留在一起。用户之后自行启动时入口为该目录的 `RainfallStudioCandidate.exe`；不要只拷贝 EXE，不要把它登记为正式版本，不要指向原用户数据根。本阶段的自动验证不执行这一可见窗口启动步骤。

## 交互路径

计划中心 → 编辑计划 → 平台/账号 → 已有专辑 → 只读刷新目录 → 选择带真实远端 ID 的候选。没有 ID 的候选只展示，不能选择为远端绑定。

计划本次执行 → 本次专辑操作 → 绑定选中的目录记录，或准备新建 → 核对平台/账号、专辑、操作编号和来源 → 明确确认。生产创建合同缺失时在 claim 前阻断。不会将本地保存专辑摘要当作远端创建成功。

绑定后按单首准备追加 → 原发布任务 → 原素材、权利、条款及提交确认。追加准备不等于远端发布。未知结果只可核对原操作，不提供重新创建或重新追加按钮。

## 交付证据

源码包含专项 Core/Main/浏览器/UI 回归。设计、协议、分层能力状态都在 docs；运行报告、审查报告和截图保存在 `output/album-integration`，便携包附带关键文档。截图标记离线夹具，不作为真实平台验收。

此前文档/截图批次未完成 Library 上传：仅准备请求，字节未完成，未 finalize、无文件 ID/版本；权限提升因缺少明确外部目的地授权证据而被自动审核拒绝，未绕过。本次根据既有客户端 EXE/源码附件授权，仅对同一客户端新版本尝试一次官方附件流程；不重试旧文档/截图批次。最终是否保存、文件 ID 和失败原因以本次独立交付报告为准，未 finalize 前不声明附件已交付。
