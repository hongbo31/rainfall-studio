# 雨序 Rainfall Studio

> 以下为历史原型记录。当前浏览器工作台请使用 [Start-Rainfall-Browser.bat](../Start-Rainfall-Browser.bat)。

AI 音乐创作到发布工作台 · 独立本地交互原型，非已打包 Windows 客户端。

机器：目标 Windows 设备。项目路径：<本机用户目录中的项目路径>

## 启动

已安装 Node.js 24，无需 npm install。

```powershell
cd <本机用户目录中的项目路径>
node server.mjs
```

打开 http://127.0.0.1:4173 。Ctrl+C 停止前台服务。

Windows 推荐入口：双击 `desktop\start.cmd`，随后打开上述地址。可在终端运行 `desktop\start.cmd --check` 检查服务脚本语法。

可选 PowerShell 入口（本机执行策略阻止 .ps1，未更改策略）：`powershell -File desktop\start.ps1 -OpenBrowser`（隐藏服务窗口，日志 output/server.log；停止时仅结束该 server.mjs 对应进程，勿结束其他 Node 项目）。

`npm.cmd run build` 生成 dist；`npm.cmd test` 运行领域测试。`node verify-browser.mjs` 使用本机已安装 Chrome 与 Codex 预置 Playwright，验证脚本的路径是本机专用，不会安装依赖。先启动服务。

## 演示路线

总览 → 创作向导 → 保存设置/歌词新版本 → 连续加入模拟队列（第二次阻止重复）→ 总览演练失败/重试 → 作品详情 A/B 导入自己的音频 → 封面工作室导出占位 PNG/导入出图/历史选择 → 发布中心预览与模拟驳回 → 数据看板导入 CSV → 账号设置备份/恢复。

CSV 示例见 output/playwright/report.csv。所有平台集成未连接；没有真实生成、扣费、上传、审核、统计拉取或账号绑定。浏览器 localStorage 保留数据；音频仅当前会话。备份不含音频；请保留原始素材。

文档：docs/requirements.md、docs/design.md、docs/capabilities.md、docs/verification.md。

