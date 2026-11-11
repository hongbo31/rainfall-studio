# 0.12.0-preview.4 安装、身份与升级验收

执行主机：DESKTOP-90VCPDC。独立工程目录：`C:\Users\31559\Documents\Codex\2026-10-15\task\rainfall-studio-unified-acceptance-20261018`。本轮可执行工程工作已完成，具备升级准备条件；正式 0.11.2 入口未切换。没有真实绑定、创建新持久账号授权、扣费生成或平台发布。

## 冻结与交付

- 产品代码：`cbcb396feb151a84bc45e24c091328f60c0f6e3b`。
- 仅说明修正的导出树：`40725da79690979d55fa6f28762b50bc1bc49328`，确认谱乐官网已提供，不重复索取。
- 安全独立源码仓库：单一根提交 `ddb39dfe0548092b85fe8108e38bcfc47351b1c7`，无 remote、无原始仓库历史。592 个文件，239 个运行时源码与产品冻结提交逐字节相同；扫描未发现凭据、用户数据库、媒体或浏览器状态。
- 安装文件：`output/release-0124-20261019/artifacts/RainfallStudio-0.12.0-preview.4-Setup.exe`，186730496 字节，SHA-256 `3eb8f698df530fa817248ed60d6a3d33140c926b6924879d5169e5982bee4cd0`。
- 安全源码：同目录 `RainfallStudio-0.12.0-preview.4-source.zip`，SHA-256 `1e8ec433ef30b04ad1fd8b5bf6ffd796615276eba5c1b7c676f4a622eb714fe8`。
- 同目录还提供完整 nupkg、RELEASES、SHA256SUMS.txt 及构建/校验说明。Setup 未签名，已实际隔离安装与卸载；没有上传、推送或部署。
- 可运行便携目录：`out/album-service-cbcb396feb15-1792406325170`，运行完整目录中的 `RainfallStudioCandidate.exe`。默认使用旁边的独立 candidate-data；显式 `RAINFALL_DATA_ROOT` 优先。不得用新空目录替换正式作品库。

## 修复与回归

| 检查 | 结果 |
| --- | --- |
| `npm run test:integration` | 223/223，0 跳过；在长工作区从当前源码构建全部前置模块 |
| `npm test` | 3/3 |
| 生产身份接线 | 16/16；含安全 IPC 错误码透传 |
| 身份状态机 / 稳定 reader | 15/15、10/10 |
| 三路由 / Windows 长路径备份 | 10/10、2/2 |
| 绑定 UI / 封面导入状态 UI | 2/2、2/2 |
| TypeScript / desktop build | 通过；Vite 有体积提示，不影响构建 |

旧调度失败由首次 tick 的计划中心接管引起。原重复、补跑、扣费及发布保护断言在明确回滚的旧调度路径保留，并新增默认接管回归。旧 SSR 艺人夹具补齐正式 revision/defaults，分别覆盖实际单次创作和旧流水线组件。没有删断言、跳过测试或用固定输出冒充通过。

另修复 SQLite 在 Windows 长路径下备份目标无法打开的问题；真实红测 `SQLITE_CANTOPEN` 后，292 字符路径备份与恢复、媒体哈希、审批清除、计划冻结及损坏归档保护全部通过。

## 身份接线与证据范围

TME 稳定 account/artist ID 已接入 Main 官方读取器、独立消息通道、Core 生产绑定服务和真实 UI 入口。读取后为 pending，用户确认才为 bound。重启、断连、导航、换号、工作区或选择变化会拒绝旧结果。确认前仅核对官方当前已加载身份，不新增官方 GET，不把 QQ/酷狗歌手 ID 称为 QQ 登录 UIN。

独立复核曾复现并修复同页换号确认旧身份、最后一次 await 后选择变化仍持久化的两项问题，最终无剩余 Important。报告：`output/identity-wiring-independent-review-20261019/independent-review.md`。

新生产 Main manager 在现有官方会话中完成两次真实只读读取及加载态核对，断开自己的 CDP 连接；无 Core 绑定写入。证据：`output/identity-production-wiring-20261019/live-main-session-readonly.json`。未重启用户浏览器，不能声称永久登录或重启后仍有效。

真实绑定全过程仅以隔离假身份验证。原生画面验证了未连接态、明确连接与读取入口、未连接读取拒绝，以及零真实绑定；没有把离线 bound 测试或未连接截图称作真实账号绑定成功。

## 原生安装与数据保护

| 阶段 | 实测 |
| --- | --- |
| 最终便携候选 | 2 个真实 Windows 原生进程，9 张截图，三组路由、单次任务去重/停止及重开持久化通过 |
| 实际 Setup 安装 | exit 0，安装到新 Temp/rsi4 目录；无同 AppID 注册或快捷方式冲突 |
| 安装后启动与重开 | 2 个进程、15 张截图，配置/身份前置门禁及总览、计划、作品、封面、发布、数据页面可操作 |
| 旧作品隔离副本 | 2 个进程、8 张私有截图；2 首作品、8 个素材、歌词封面保留；4 次 A/B 实际解码并检测 audible |
| 实际卸载 | 本次安装自己的 Update.exe，exit 0；测试注册表项移除、无新增快捷方式残留、测试数据保留 |
| 正式数据 | 安装前后、原生后及卸载后均核对 31 个文件约 85 MB，字节哈希完全相同；排除 runtime 缓存/锁；正式指针及原快捷方式哈希不变 |

最终共 6 个原生进程、32 张截图。已检查进程退出、Windows 原生异常和本地生命周期记录。无外部模型/发布请求。原媒体截图和数据库保持本地私有；仅 24 张隔离假数据的便携/安装界面图进入 `output/deliverables/RainfallStudio-0.12.0-preview.4-visual-evidence.zip`。

主要原始证据：

- `output/native-0124-portable-20261019/run-1792406358555/report.json`
- `output/installer-0124-acceptance-20261019/installation.json`
- `output/installer-0124-acceptance-20261019/run-1792406745222/report.json`
- `output/native-media-0124-1792406811739/report.json`（私有原作品信息，禁止并入公开交付）
- `output/installer-0124-acceptance-20261019/uninstall.json`
- `output/installer-0124-acceptance-20261019/formal-data-verification-after-uninstall.json`
- `output/ux-0124-final-review/report.md`

## 用户下一步的具体动作

已有谱乐官网为 `https://app.yourmusic.fun/create`。只读核对确认正式库有“谱乐 AI · 个人音乐创作”配置，以及 YourMusic `chirp-v6` 的一次 `assets_verified` 历史。未读取或输出任何密钥；不再索取官网。现有历史和凭据不能自动授权本轮新扣费任务；新增模型或渠道才需其精确 API 文档/配置及预算依据。

沿原 dataRoot 升级后，需要用户确认的实际映射是：本地 TME 账号“栩你听海 · 腾讯官网观察”与本地艺人“我的艺人”，对应官方艺人“栩你听海”、TME 账号尾号 638、艺人 ID 尾号 255。若本地艺人名称需要修改，可先在“艺人与预算”更名保存；不能由开发验收代替用户决定映射。

具体入口：配置中心 → 发布平台 → QQ 音乐（TME 路线）→ 选择上述账号/艺人 → 连接已有官方会话（当前已核实端口 9222）→ 读取账号身份 → 核对完整远端 ID 与本地目标 → “确认此账号与艺人映射”。读取会保存等待确认的映射，最后一步会持久化 bound，本轮均未代执行。失去登录时由用户在官方页面登录后再连接核对，不建立新的持久认证。

封面无需图片 API Key：本地或 dot 外部结果导入可用，UI 明确显示“外部导入 · 无需 API Key”和“图片生成 API：未接入”。用户可提供原创/获授权图片或外部生成结果文件；没有免费直连 Codex 图像 API。发布仍需平台权限、具体作品授权和确认；没有进行无人值守全平台发布验收。
