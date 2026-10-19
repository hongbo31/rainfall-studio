当前 0.7.1 修订：北京时间 09:00（Asia/Shanghai / 01:00 UTC）与腾讯 AI 作品准备执行器，明确停在新三年条款待确认。真实、离线与未接入边界见 [本轮说明](release/beijing-tme-ai-0.7.1.md)。官网可选保存的未知结果保留，不重试，不冒充成功。

# 设计与技术说明

当前0.7 Windows客户端使用现有Electron44、React/TypeScript、SQLite及本地FFmpeg，Main/Core/renderer分层；早期零依赖网页保留作历史原型。持久调度/预算/评分/素材/发布端口设计与验收以 [0.7说明](release/production-flow-0.7.md) 为准，桌面作品不存网页localStorage。

视觉：深炭黑工作台、暖紫点缀；左侧导航、中央创作区域、底部真实音频播放器。1440px 桌面布局和 390px 移动降级；中文层级、状态标签、足够对比。总览用三章爱情故事形成叙事中心。

采用零依赖 Node 24 本地 HTTP 服务与原生 ES Modules，原因是现有机器有 Node/npm，但 dotnet --list-sdks 无 SDK 输出；不安装任何软件或依赖。备选 Electron 打包需现有 Electron 环境或后续批准安装；Tauri 需要额外 Rust/WebView2 工具链，当前不采用。

目录边界：web/app.js 为页面与交互、web/domain.js 为纯领域逻辑、web/style.css 为设计系统；server.mjs 仅 loopback 静态服务；desktop/ 为独立 Windows 启动边界与未来壳源代码；docs 为需求/能力/验证文档。dist 为已构建前端文件，不是 Windows 安装包。

持久化：localStorage schema 1；备份 JSON 校验顶层及作品必需字段，恢复前自动下载原数据。图片限制 2 MB，每次导入保留版本，容量满时提示导出；不适合大量素材生产存储，后续迁移 SQLite+本地媒体目录。所有用户内容按文本转义；无远程字体/图像/CDN。服务仅绑定 127.0.0.1；CSP 限制连接同源。

平台适配契约（后续）：GenerationAdapter.prepare/importResult、CoverAdapter.prepare/importImage、ReleaseAdapter.preparePackage/getReview、AnalyticsAdapter.importReport。每个适配器应返回 capability/status/source/observedAt，不可用必须明确 unavailable 或 manual-import。对外操作必须由用户明确授权并核验平台许可。账号字段规划为 id/platform/displayIdentity/authStatus/ownerId/role；令牌后续由 Windows Credential Manager 管理，不能存 localStorage。

队列未来应持久化幂等键、服务商请求号、重试次数、预算预留与实际消耗，并在真实扣费前二次校验。当前幂等键覆盖作品/平台/歌词/风格/人声，只适用于演练；不能作为生产计费防重保证。

封面：CSS 渐变与雨线提供原创占位；canvas 真实导出 PNG，可导入 PNG/JPEG/WebP 并保存历史。导入图以居中裁切覆盖，文字靠下；平台尺寸仅工作预设，正式提交人工核验。后续可加入安全区、裁切调整、字体选择和授权凭证。Codex 入口仅复制/下载提示词任务，实际调用由具备图像工具的父会话完成。
