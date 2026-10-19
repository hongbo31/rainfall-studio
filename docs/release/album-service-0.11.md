# Rainfall Studio 0.11.0-preview.1

独立 Windows 便携候选；未安装、未替换桌面快捷方式或正式版本指针。只在本项目新目录构建，默认使用候选目录自己的 `candidate-data`。本阶段未启动桌面窗口。

专辑执行链的具体生产限制见 [交付状态](../acceptance/2026-10-19-album-service-status.md)。现有计划、原 YourMusic 路径、A/B 素材、dot 接收和原统一发布链继续保留。

## 本地构建及验证

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

Library 上传未完成：官方 helper 仅完成准备请求；字节传输未完成，未 finalize，未取得文件 ID/版本。网络权限提升被自动审核拒绝，理由为缺少用户对指定外部 Library 目的地的明确授权证据。本地文件完整保留；没有绕过审核直接上传。
