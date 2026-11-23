# Rainfall Studio 项目交接

状态核对于 2026-11-19（北京时间）。新会话开始时，重新核对 Git、桌面指针和当前任务。平台回执与账号状态取最新可验证结果。

## 项目与版本

Rainfall Studio 是本地优先的 Windows AI 音乐工作台。用户用它管理多个艺人和平台账号，从歌词和曲风、谱乐音频 A/B、每首专属封面，一直做到作品入库、查重、批量上传与合同准备。Electron 主进程保护本地文件和会话，React 提供桌面界面，Core 用 SQLite 和受管素材目录保存状态。

| 入口 | 当前状态 |
| --- | --- |
| 本机源码 | `H:/CodexData/Workspace/Rainfall-Studio/source`。本次交接核对的功能基线是 `05b4e2be7c4b0fbb30a584eeefe145a8b233a7d2`。飞书反馈与汽水接入已合并。 |
| GitHub 下载包 | Windows x64 免安装预发行版 `v0.12.0-preview.14`。标签与上述提交一致，ZIP 和校验文件已比对 GitHub 返回的 SHA-256。[GitHub Release](https://github.com/hongbo31/rainfall-studio/releases/tag/v0.12.0-preview.14) |
| 本机 ZIP | `H:/CodexData/Workspace/Rainfall-Studio/build/out/RainfallStudio-0.12.0-preview.14-05b4e2be7c4b-win-x64.zip`。同名 `.sha256`，构建记录为 `build/records/rsb-fd1052b8.json`。 |
| 本机桌面入口 | 「Rainfall Studio 音乐客户端」。当前权威指针 `%LOCALAPPDATA%/RainfallStudioLauncher/verified-desktop.json` 仍为 `0.12.0-preview.13`，源码 `d94f020b8b02`。读取指针中的 `dataRoot` 和 `packageRoot` 来识别正式库和运行包。 |

## 用户怎么用

1. 在「配置中心 → 模型 API」配置文本、音乐和封面来源，在「账号管理」添加平台账号、绑定艺人、打开专属登录窗口。
2. 在「创作中心 → 单次 AI 创作 → 风格混搭」选艺人、写故事、选择曲风。在「计划中心」可批量执行，保存计划后可立即运行或启用定时。
3. 在「作品库」核对音频、封面和平台状态。生成的曲风描述在「作品详情 → 歌词与创作提示 → 提示词」。在「发布中心」选作品、平台及账号，查看各渠道独立的处理状态。
4. 番茄按已选账号、艺人署名和发行配置准备上传与合同。用户核对并处理官网签署或验证码。上传完成、待授权、审核中和已上架分别以平台回执判断。

## 能力与验收

| 能力 | 实现与证据 |
| --- | --- |
| 人声与纯音乐 | .14 的文本提供商路线可按主题、艺人默认值和混搭曲风分别构思每首歌词，评分和限次改写后把定稿与曲风提示交给谱乐。纯音乐跳过歌词阶段。作品保留音频版本及素材绑定。老的谱乐快捷计划仍可读。 |
| 封面 | 支持按首使用 OpenAI 图片 API，也支持本地导入与自动收图。每首需要自己的封面，计划检测复用。本机正式库目前只有谱乐和 DeepSeek 的提供商条目，真实调用前核对该任务需要的模型、配置和额度。已上架作品的换图走原记录编辑。 |
| 番茄音乐／番茄畅听 | 已有官网查重、单首真实上传和同账号合并签约证据。独家授权和两个发行平台沿用账号发行配置。跨艺人署名和纯音乐上传代码已接入，纯音乐表单通过隔离测试，跨艺人同合同和纯音乐仍需最新版真实官网验收。飞书提到的 200 首／合同、每天约 30 多次签约是待核实观察。 |
| 汽水音乐 | .14 有独立账号档案、材料核对、填表上传、选择授权、当前合同核对和验证码停点的代码，已通过隔离页面测试。既往真实上传和打开合同通过官网浏览器操作完成。客户端真实登录复用、上传读回及合同验证码路径仍待端到端验收。业务细节见 [汽水音乐接入](../docs/integrations/qishui-automation.md) 和 [汽水网页验收](../docs/acceptance/2026-11-14-qishui-automation.md)。 |
| 腾讯音乐（QQ 音乐／酷狗） | 共用腾讯发布路线。客户端提供投稿准备、现有记录回读和相关确认入口，继续以实际账号、路线与回执核验正式提交。已做隔离验证，番茄等待时腾讯任务能独立推进。 |
| 浏览器发布台与多账号 | .14 随桌面后台启动本机发布台，复用作品库和队列。官网账号各有持久浏览器档案，工作窗口和艺人有关联。同一登录会话的写入按账号收敛。隔离测试覆盖并行推进、重复点击、窗口与艺人复用。浏览器发布台需要本机桌面后台在线。 |
| 每天 09:00 生成 10 首 | 用户希望轮换恋爱、治愈和生活故事，逐首生成歌词、音频和封面，同一番茄账号批量上传后准备一份合同。正式桌面库现有「每日 09:00 · 10 首」计划仍停用。恢复前核对模型、封面来源、账号和主题配置，先验收小批再启用。 |

## 代码入口

| 工作 | 入口 |
| --- | --- |
| 界面与本机进程 | `src/renderer/main.tsx`、`src/preload/index.ts`、`src/main/bootstrap.ts`、`src/core/index.ts` |
| 创作、曲风、定稿、定时 | `src/renderer/components/ManualCreation.tsx`、`src/renderer/pages/PlanCenter.tsx`、`src/core/generation-config.ts`、`src/core/provider-plan-text.ts`、`src/core/plan-center/` |
| 谱乐与封面 | `src/core/workflow/yourmusic.ts`、`src/core/plan-pule.ts`、`src/main/plan-pule.ts`、`src/main/plan-cover-image.ts`、`src/core/cover-inbox.ts` |
| 作品库与发布 | `src/renderer/pages/Track.tsx`、`src/renderer/pages/PublishCenter.tsx`、`src/main/publish-workbench.ts`、`src/renderer/pages/BrowserPublishWorkbench.tsx` |
| 账号与渠道 | `src/renderer/pages/PlatformAccounts.tsx`、`src/main/browser-accounts.ts`、`src/main/fanqie/`、`src/main/qishui-flow.ts`、`src/main/tme/` |
| 打包与启动 | `Build-Latest.ps1`、`scripts/Build-ArtifactRetention.ps1`、`scripts/verify-portable-build.cjs`、`scripts/Launch-Verified.ps1` |

## 新会话接手

其他机器可在有访问权限的情况下克隆 GitHub 仓库，从检出目录打开新的 Codex 会话。H 盘路径和桌面指针用于原 Windows 主机，换机器时从仓库的相对路径开始，并按 README 准备本地环境。[GitHub 仓库](https://github.com/hongbo31/rainfall-studio)

- 先读 [AGENTS.md](../AGENTS.md)，确认 PowerShell 主版本为 7。记录 `git status --short --branch`、当前提交和远端 `main`。构建、验证库、日志和缓存使用 H 盘的隔离路径。具体安装命令见 [README](../README.md)。
- 同一源码工作区只安排一个写入会话。并行改动使用单独检出，先确认正在进行的任务和未提交改动。新会话优先读本记录及用户的新任务，然后核对相关实际入口。
- 生成调用或上传结果不明时，从已有任务和官网作品记录核对，避免重复扣费、重复上传。涉及实际上传时沿用用户指定的作品、A/B 版本、账号及艺人。保持账号登录与发布配置隔离，Git 和交接文档只存源码、配置示例和脱敏证据。
- 现有包验证通过后再按 [桌面交付规范](../docs/release/desktop-delivery-policy.md) 切换同一快捷方式，复用当前指针的正式数据根并保留回退包。该规范里的旧目录是历史记录，本机以实时指针为准。

## 验证记录与接手顺序

- .14 桌面构建及 TypeScript 通过。汽水、浏览器发布台和番茄相关浏览器回归 21 项通过，番茄定时生成和上传 14 项通过。集成测试 231 项中通过 230 项，剩余测试依赖未随源码交付的历史 100 首本地样本目录。
- .14 压缩包已校验源码清单、SHA-256，并用随包运行时在隔离路径创建和重新打开空作品库。桌面升级需要另做真实库、试听封面及旧入口回退验收。
- 优先闭环汽水客户端真实端到端验收。之后验收番茄纯音乐与同账号跨艺人合同，核实官网限制。待以上发行路径可核对回执后，再确认每天 9 点 10 首计划所需的生成配置并做批量实测。
- 本机历史索引包括 `H:/CodexData/Workspace/Rainfall-Studio/handoff/2026-11-13-音乐平台反馈改进方案.md`、`validation/qishui-new-song-20261114` 和 `validation/qishui-new-song-20261115`（相对 H 盘 Rainfall 工作区）。项目反馈来自 [飞书《音乐平台问题》](https://my.feishu.cn/wiki/DJC9wq9jsi0K0SkNgkhcDBBanid)。官网截图、个人账号和素材留在本机，引用时用脱敏回执。

### 可复制到另一个 Codex 会话

> 继续 Rainfall Studio。Windows 本机源码在 H:/CodexData/Workspace/Rainfall-Studio/source。先读取根目录 AGENTS.md 和 handoff/PROJECT-HANDOFF.md，确认当前 Git 和桌面实际版本，再按我这条消息指定的范围实施。用 PowerShell 7，隔离构建及测试数据放 H 盘，保留正式作品库和账号登录态。根据实际验证报告结果。
