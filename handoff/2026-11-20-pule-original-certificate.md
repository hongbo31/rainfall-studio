# 谱乐原创证书入口与本地下载

## 官方接口范围

本轮公开读取谱乐 OpenAPI 1.0.0，返回 HTTP 200。歌曲查询和历史返回歌曲 ID、音频及相关元数据，文档未列出原创证书字段或下载端点。谱乐网站的「我的作品」入口为 `/personal`。API 生成的歌曲能否在该账号领取证书，仍需实站核对。[谱乐 OpenAPI](https://api.yourmusic.fun/v1/openapi.json?lang=zh) · [谱乐我的作品](https://app.yourmusic.fun/personal)

## 改动与影响

- `src/renderer/pages/Track.tsx` 在创作中心和作品库共用的「来源与授权依据」中提供「谱乐我的作品」「导入原创证书」和「下载已导入证书」。谱乐入口按已保存的来源显示。下载取当前作品绑定的证书附件，支持原 PDF、PNG、JPEG 和 WebP。
- `src/main/bootstrap.ts` 由已存在的桥接和系统保存对话框处理浏览器、Windows 两端的下载请求。打开谱乐仅指向固定的官方作品页。
- `src/core/work-certificate.ts`、`src/core/index.ts` 按作品和附件 ID 核对当前绑定及格式。`src/core/assets.ts`、`src/core/work-audio-share.ts`、`src/shared/work-analysis.ts` 让音频和证书复用文件名处理与受管原件导出。导出核验哈希，保存位置须在作品库外。原有导入和归档流程适用于已有证书。

## 验证

- 在同级构建目录的 `pule-certificate-9719c054/source` 完成 31 项离线回归测试。创作中心无头检查验证官方入口和证书下载动作，Core 检查原件字节一致、已更换附件绑定时拒绝旧导出，以及作品库目录保护。既有音频下载、证书归档和 AI 作词回归通过。
- TypeScript 及 Windows Electron Main、Core、预加载和共用渲染层构建通过。原生窗口和系统保存对话框使用夹具之外的交互尚未验收。真实谱乐账号领证和正式桌面包交付待验证。

## 后续与回退

正式一键领取需要谱乐提供对当前 API 账号开放的证书接口和歌曲 ID 绑定方式。回退时撤销以上对应功能和 `tests/creation-work-detail.test.mjs`、`tests/work-analysis-share.test.mjs` 中本次证书用例。已导入的证书和原作品数据仍可由已有导入、归档流程使用。
