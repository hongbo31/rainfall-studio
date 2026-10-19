# Rainfall Studio

中文 Windows 音乐创作与发布准备工作台。当前发布为 **0.11.2-preview.2**；这是预览版本，真实音乐生成、账号权限及平台投稿需分别配置和授权。新豆包与通用目录任务功能仍在独立开发分支，本版不包含。

## 下载与安装

从 [v0.11.2-preview.2 Release](https://github.com/hongbo31/rainfall-studio/releases/tag/v0.11.2-preview.2) 下载 `RainfallStudio-0.11.2-preview.2-Setup.exe`，核对同页 `SHA256SUMS.txt`。这是包含 Electron 和依赖的 Squirrel Windows x64 安装器；便携目录内单独的应用 EXE 不能当安装器使用。

仓库当前为私有，下载需有访问权限的 GitHub 账号。安装包未配置发布者代码签名；请核对来源与哈希。没有执行安装/卸载或全新 Windows VM 验收，不把静态封装检查等同于安装成功。

已在一台 Windows 主机核验同版本完整客户端、原作品和封面、真实 A/B 播放、正常重开与受管理桌面入口复用。安装器不包含用户数据库、媒体、凭据或浏览器状态。不要用默认空数据根覆盖已有库；已有受管理客户端应继续使用其已核验入口，迁移前保留独立备份。本次发布不会自动安装或修改任何现有桌面入口。

旧 [v0.5.1](https://github.com/hongbo31/rainfall-studio/releases/tag/v0.5.1) 与远端提交历史保留。历史版本说明不代表本版接入能力。

## 实际架构

- Electron 44.7.2 桌面壳，React 19.3.1 / TypeScript / Vite 界面。
- Main 管理窗口、文件选择、安全凭据、HTTPS 和官方网页适配器；preload 只暴露受限 IPC。
- 独立 Core 管理业务和 SQLite，使用 `better-sqlite3` 13.0.3 直接 SQL，无 ORM；schema 3，事务立即加锁。
- 艺人、账号、绑定、作品、版本、素材、系列、操作、预算、指标、草稿和收件回执分域保存。统一计划实体在 settings 命名空间中持久化。
- 媒体在数据根的 `media/sha256/`，数据库保存引用和校验和。凭据由 Windows 安全存储独立加密，不进入源码和普通备份。
- 客户端运行时调度；关闭后没有安装的后台服务。dot/Drive 为文件交接，未内置免费 Codex 图像 API。

## 能力边界

可编辑创作参数、歌词与提示词，管理系列/版本/本地音频和封面，准备多平台材料，查看队列和错误、导入统计报表。封面工作室支持提示词、外部出图结果导入、版本与排版。缺少音频时不假播放。

DeepSeek、音乐服务、封面、投稿与统计是分别授权的适配路径。专辑生产写入合同和无人值守全平台发布仍未完成校准；不能把本地准备、模拟或只读观察称作上传/发布成功。抖音视频发布与音频发行分开。Suno 官方 API 未核实；第三方音乐路由不代表官方 Suno 接口。豆包与通用目录任务不在本版。

## 从源码构建

需要 Windows x64、Node 24、npm、Git。先使用独立工作目录，勿复制用户库或密钥。

```powershell
git clone https://github.com/hongbo31/rainfall-studio.git
cd rainfall-studio
git checkout v0.11.2-preview.2
npm ci
npm test
npm run typecheck
npm run desktop:build
```

本机构建使用既有 Electron、SQLite 原生模块和 Squirrel 工具，没有安装新软件。全新机器的依赖安装及原生 ABI 仍需匹配 Electron；必要时使用项目既有 `electron-rebuild`。媒体探测/导出需要已安装的 FFmpeg；不自动下载。

`npm run desktop:dev` 会打开窗口，运行前设置独立的 `RAINFALL_DATA_ROOT`。`npm run desktop:make` 是通用 Forge 安装封装入口。该 Release 的实际构建与验证记录、源码提交和安装器校验和在附件中；并未执行 Setup。

技术需求、设计和通用协议见 [docs/requirements.md](docs/requirements.md)、[docs/architecture/README.md](docs/architecture/README.md)。发布快照排除了机器操作记录、私人账号观察、Drive 私有目录与本地私密历史；运行时代码与本地已验收版本逐文件核对。
