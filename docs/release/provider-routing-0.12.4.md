# 0.12.0-preview.4：稳定身份生产接线与恢复修复

本版本将 2026-10-19 校准的 TME 稳定身份读取器接入 Main / Core 生产绑定入口；不再交付遗漏该补丁的 preview.3 作为最新升级包。历史 preview.3 验收及只读校准记录仍保留各自冻结时的事实。

## 账号操作顺序

1. 在客户端选择本地艺人和 TME 账号资料。
2. 用户明确点击“连接已有会话”，连接自己已经开启的本机官方浏览器端口；不启动浏览器或建立新持久登录。
3. 点击“读取账号身份”，从官方页面自己的响应与当前加载态核对 TME account/artist ID，并保存等待确认的本地映射。
4. 查看远端账号、艺人 ID 与本地艺人，点击“确认此账号与艺人映射”。确认前再次只读核对当前加载态，不发起新的官方 GET 或平台写入。

绑定状态与登录状态独立。断连、页面导航、换号、模式/工作区变化或会话失效会使登录待核对；重启后不会恢复 valid。未知外部结果保留对账边界。TME account/artist、QQ 歌手和酷狗歌手 ID 命名空间分开，不能称为 QQ 登录 UIN。

Main 是官方会话与读取器的唯一拥有者。Core 通过专用 request/result 通道调用官方适配器，响应和失效消息在串行 RPC 链外消费。Renderer 只传本地选择或明确确认，不能提供远端 ID、观察结果或适配器合同。旧 OfficialAccount、复合 hash 与发布 intent 合同保持不变。

本次开发与验收不会在真实会话上执行绑定 start/confirm，不保存新持久账号授权，不创建凭据，不调用付费模型或发布平台。真实绑定流程仅使用隔离假身份验证；现有真实会话仅验证 Main 读取器。

## 恢复修复与验证入口

- 调度回归明确区分计划中心默认接管和显式回滚的旧调度路径。重复执行、补跑、付费与自动发布断言全部保留，并增加接管单一调度权的回归。
- SSR 夹具使用正式艺人 revision/defaults，分别覆盖当前单次创作与旧流水线真实组件。
- Windows SQLite 备份及恢复候选使用扩展长度路径，修复长工作区 `SQLITE_CANTOPEN`；归档校验、审批剥离与计划冻结不变。
- 集成 runner 从当前源码构建直接导入的 Core/API 凭据模块和 provider-text 测试模块，不依赖旧输出。

```powershell
npm test
npm run typecheck
npm run test:integration
node scripts/test-identity-production-wiring.mjs
node scripts/test-account-identity.mjs
node scripts/test-official-stable-identity.mjs
node scripts/test-account-binding-ui.mjs
node scripts/test-backup-longpath.mjs
node scripts/test-generation-routing.mjs
npm run desktop:build
```

桌面开发启动应使用独立数据目录：

```powershell
$env:RAINFALL_DATA_ROOT = Join-Path $env:TEMP 'rainfall-studio-dev-isolated'
npm run desktop:dev
```

`npm start` 是网页原型；真正 Windows 客户端使用 Electron 桌面构建或 Setup。安装验收、校验和与截图以本轮实际输出报告为准；未验收候选不得自动切换正式快捷方式。将来升级正式入口时必须沿用其 verified-desktop.json 的原 dataRoot，不用新空目录替代旧作品库。

## 仍需用户输入

| 项目 | 用户需要提供或确认的内容 | 当前能力 |
| --- | --- | --- |
| 真实身份绑定 | 本地艺人与远端 TME 身份的具体映射，点击读取及确认 | 代码已接线；本轮未对真实账号执行 |
| 已有官方会话 | 浏览器未登录时由用户在官方页面登录；需连接时给出其本机调试端口 | 不创建账号、凭据或新持久登录 |
| 文本/音乐真实生成 | 用户自己的凭据、精确模型、官方价格依据及单任务预算授权 | 未配置时失败关闭；不自动扣费 |
| 谱乐 AI / YourMusic | 官网已明确为 `https://app.yourmusic.fun/create`，无需再次提供 | 现有 YourMusic 配置及 `chirp-v6` 音频已验证历史已只读核对；新增模型或渠道才需对应 API 文档、配置与本次预算依据，不把官网网址当阻塞 |
| 封面 | 用户原创/获授权图片，或外部会话生成结果文件与对应请求 | 本地图片与 dot 结果导入可用；图像 API 未接入 |
| 发布与统计 | 各平台开放权限、作品授权及具体发布确认，或官方导出报表 | 音频发行与抖音视频分开；未验证的真实写入仍关闭 |

封面 UI 保持“外部结果导入 / 未接入”状态，没有创建虚假图像 API 配置，没有承诺免费 Codex 图像 API。无需为本地或 dot 导入填写不存在的 API Key。

现有 YourMusic 凭据的值没有读取或输出；历史 `assets_verified` 记录证明以前的生成与素材流程，不能自动授予本轮新扣费权限。当前真实身份映射的具体本地账号、远端艺人及确认动作见本机验收报告中的个人映射说明，未写入公开源码材料。
