# 端到端交付验收清单（2026-10-19）

本地可实现的恢复缺陷已经收口：纯歌词/封面计划可保存最终歌词建立可追溯作品、进入原封面工作室交接并显式选图后重试完成；cover/materials 已消费持久化的本地重试 attempt；登录观察提示与失效清理已修复。当前仍不能宣称正式桌面已升级，或真实生成、收费、上传、全平台发布已端到端通过。

精确源码提交、候选包路径、版本与校验结果，以 `output/deliverables/RainfallStudio-0.11.2-preview.1-delivery.json` 和其中引用的包级报告为准。两份报告必须指向同一 sourceCommit、同一 `0.11.2-preview.1` 包且校验通过；报告尚不存在时不作候选就绪结论，旧版本的 passed 报告不能代表当前版本。本文不以候选包替代正式交付。

本轮后续已按明确授权后台只读核对生产专辑页面与原库 inbox 绑定/owner字段，未读作品内容或凭据，不修改原库、正式计划或正式入口，未启动可见窗口。正式入口此前只读证据为 `output/desktop-upgrade-preflight-20261019/formal-readonly-consistency.json`：`0.8.3-preview.2` / `227738d`，14组件hash匹配、launcher与仓库一致、`formalEntryChanged=false`、`oldPointerNativeGuiValidated=false`。这证明程序完整性，不能解释为原生全量验收。当前绑定核对、隔离真实请求与云端逐字节回读见 `output/drive-v2-acceptance-20261019/`。

## 证据口径与总回归

- **真实**：已有外部系统或原生桌面操作记录，注明日期、版本和范围。历史成功不自动覆盖当前版本。
- **隔离**：真实生产源码、SQLite、React、浏览器或broker配合合成数据/外部响应fixture。测试名含 real、production、E2E，也不等于真实平台验收。
- **未验证/禁用**：没有足够记录，或生产能力仍被门禁关闭。源码实现、构建、候选包和程序hash一致均不能替代业务验收。

总回归实际组数、各组退出码与完成状态，动态读取 `output/drive-v2-completion/final-verification/report.json` 的 `results` 和 `passed`；执行中的中间快照不作全组完成结论。该测试套件声明 `nativeGuiLaunched=false`、`formalDataTouched=false`、`externalWrites=fixture-only`；获准的真实只读与Drive请求导出另有独立报告。不把较早总回归组数写成当前固定数量。

以下路径相对仓库根目录。

## 逐项验收

| 环节 | 已实现行为与实际证据 | 验证层级 | 剩余边界 |
|---|---|---|---|
| 计划创建、编辑、保存、启停 | `src/core/plan-center/index.ts` 持久化Plan/Run/Item、revision CAS、执行快照与活动run锁；实际React表单已验证。证据：`output/album-integration/final-verification/plan-center.log`、`plan-center-headless.log`。 | 隔离通过 | 当前正式旧配置的显示、保存和原生操作尚未在原数据根验收；留给正式升级步骤，不再列为未实现计划功能。 |
| 定时运行 | `plan-center/schedule.ts` 按Asia/Shanghai支持每日/每周/单次；持久化occurrence、skip/bounded catch-up；存活Core每秒tick。日历、跨连接唯一claim、补跑边界已测试；升级进程验证包含跨预定时间无意外消费。 | 隔离通过 | 定时依赖应用/Core存活；未安装独立Windows任务/服务。退出应用后的常驻执行不是现有已交付能力，不默默安装启动项；若另有该要求应单独明确生命周期需求。 |
| 立即运行与数量 | preview/run校验revision、summaryHash、requestId；数量是独立Item，A/B是同一Item版本；立即运行不占定时occurrence。实际React验证取消、并发修改、确认与重复点击拒绝。证据：`plan-center-headless.log`。 | 隔离通过 | 当前用户原数据上的原生立即运行未执行；无需重复开发本地执行状态机。 |
| 歌词/封面dot请求与回收 | `plan-center-dot.ts`、`inbox/plan-dot-bridge.ts` 已实现immutable requestId/hash、v2 exact echo、owner reservation、requests投影、receipt/association、迟到隔离；status和UI已有请求、桥状态/原因及关联显示。证据：`final-verification/plan-dot.log`、`tests/plan-dot.test.mjs`；协议：`docs/integrations/dot-plan-drive-protocol-20261019.md`。 | 当前v2隔离通过；历史v1真实回收 | 当前v2真实请求已保存并投影至独立Drive子项目，云端逐字节回读匹配；真实producer回传、Drive云端回执和本地association对照尚未完成。历史真实证据 `output/formal-dot-upgrade-1792351209999/post-promotion-verification.json` / `cloud-formal-receipt-readback.json` 仅覆盖0.8.3历史回收，不证明当前v2生成触发。没有已验证dot远程API。 |
| 自动评分、改写与封面恢复 | 精确候选managed scoring、模型分/规则分隔离、最终改写材料保存已实现。新 `planCenter.prepareCoverWork` 将无音乐Item的权威最终歌词建立为无音频/无旧封面的本地work，以sidecar关联run/item/artist/final draft/pair/raw歌词hash；复用CoverHandoff接收、显式选图及retry。cover/materials worker已处理当前dispatching，本地unknown仍不执行。证据见下节。 | Core、独立探针与实际React隔离通过 | 真实评分/收费与真实出图仍未验收。“自动再次触发dot出图”是可选外部自动化增强，现有显式本地交接已经可恢复，不再作为本地缺陷待办。 |
| 音乐提交、查询、下载、导入 | 原ProductionFlow / YourMusic broker与adapter、profile/revision、预算/credit policy、原operation/song IDs查询、A/B下载与媒体校验、unknown冻结均已实现。证据：`final-verification/managed-music.log`、`plan-pipeline.log`、`plan-models.log`、`plan-model-credentials.log`。 | 隔离通过 | 真实账号模型可用性、余额/准确费用、一次实际生成与原回执尚未验证；history不代表当前权限。Suno官方直接API未实现，Pule不因可选项即视为已可用。实际调用由父任务按授权协调，不能用更多fixture冒充。 |
| 已有音频与A/B选择 | `plan-center-assets.ts` 校验艺人、作品/歌词修订与资产hash；manual保留原A/B、选B贯穿材料；付费快照拒绝手动音频注入。证据：`plan-assets.log`、`plan-run-assets-ui.log`、`plan-center-headless.log`。 | 隔离通过 | headless媒体URL是fixture适配；当前原生media://播放、seek、用户原音频与封面显示仍需原生验收。文件hash/选中版本重开保持以包校验报告为准，不写成已试听。 |
| 平台/账号/专辑 | QQ/酷狗TME目录账号隔离、双源分页、远程ID绑定和Main/Core/UI门禁已实现；网易云/汽水/抖音适配器未实现且显式禁用。证据：`output/album-pagination/final-review.md`、`pagination-final.log`、`legacy-final.log`、`final-verification/album-ui.log`。`official-readonly-proof.json` 为05:57:54–05:58:12真实只读：已发布3、未发布0、引用0，主tab保留、后台目标、写入0。 | 真实只读 + 隔离写流程 | `TME_ALBUM_PRODUCTION_CREATE_CONTRACT=null`，append仍为 `EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED`。真实albumId读取已实现，生产当前选择为none；阳性选择与创建原操作回执尚需可观察平台校准和外部授权。非TME需要各自适配器与校准，抖音另需视频流程；不能宣称全平台自动发布。真实多页/非空未发布/后续cursor当前只有fixture证据。 |
| 停止 | 先持久化stopRequested，再停止managed文本/音乐；阻止新claim/POST，原在途回执继续归原run。新增封面恢复在request、接收持久化、选图前均检查stop/当前上下文，async停止竞态不提交新资产/receipt/选择。证据：`plan-center.log`、`managed-music.log`、`plan-pipeline.log`、`output/cover-recovery/final-core-tests.log` 与独立探针。 | 隔离通过 | 本地停止不等于外部任务撤销或退款；真实在途停止没有执行。不得复用已发布作品做试验。 |
| 重启与未知结果恢复 | dispatching恢复为unknown，原operation/owner核对，不盲目再发；封面恢复SQLite重开保持幂等，unknown不执行。实际旧Core→新Core→重开与单独reopen进程验证已完成，见下节。 | 当前进程级隔离通过；历史原生隔离 | 当前可见原生kill/relaunch仍未执行；隔离进程验收不等于原生窗口/系统媒体协议验收。 |
| 账号环境、登录复用与失效 | `PublicationBrowserConnection` 已明确“连接不代表登录”；有效观察含时间戳，5分钟本地观察到期、会话变化/离线/状态读取失败即清理；错误不把连接问题伪装成确认登出。证据：`docs/acceptance/2026-10-19-login-session-reuse.md`、`output/login-session-audit/targeted.log`（21/21）、typecheck及npm-test日志。 | 提示和会话负例隔离通过；当前会话曾真实只读 | 产品附加已有loopback CDP，不创建managed persistent profile；客户端重启需重连和fresh核对，不意味着必需重新扫码。06:27:59的CIM元数据查询 `cim-unavailable-or-access-denied`，实际profile是否临时/稳定未知；不绕权限，不读cookie/cred。真实浏览器重开/登出/验证码/切换账号仍未验收，不能承诺永久登录或全平台登录复用。 |
| 旧配置迁移与回滚 | 已用实际0.8.3 Core公共方法创建合成旧库，再由新Core升级，同一库第三进程重开，另有独立reopen-only；保留原ID/配置/媒体hash、归档旧调度并转需复核的新计划，迁移幂等且无新增收费/发布。证据：`output/upgrade-compatibility-latest.json`、`upgrade-compatibility-reopen-latest.json`、说明文件。 | 实际跨版本Core进程隔离通过 | 不是手工伪造旧schema；也不是原用户库迁移。当前精确包的Core/运行时匹配以交付/包校验报告为准。原库一致快照、业务数据对照和恢复验收仍由父任务协调。 |
| 精确包、版本、正式桌面与数据一致性 | 构建/包级验证、源提交、版本与文件hash统一由 `output/deliverables/RainfallStudio-0.11.2-preview.1-delivery.json` / `output/album-package-validation.json` 给出。正式旧pointer的14组件hash和launcher只读预检已通过，lnk/pointer/launcher已备份。 | 具体包结果依报告；旧程序完整性真实只读通过 | 只有两份报告同版本/commit且通过才可认定候选就绪；无论候选结果如何，正式升级仍须原库快照、原生验收和同一快捷方式的实际EXE/dataRoot/资产对照。当前NoPopup，不写成已正式切换。 |

## 已收口的本地缺陷和独立验证

### 封面恢复与本地retry

设计：`docs/superpowers/specs/2026-10-19-plan-cover-recovery.md`。实现入口为 `src/core/plan-cover-work.ts`、`planCenter.prepareCoverWork`、`CoverHandoff` 的窄guard/selected receipt核验，以及cover/materials本地attempt消费。

已验证：纯歌词/封面改写后创建幂等work；无音乐/无旧图；当前最终歌词/标题/artist/run/item指纹；原旧cover和foreign/stale receipt拒绝；显式选图；cover与materials重试继续；停止竞态；普通图片导入旁路拒绝；文件损坏；歌词/选图漂移；当前有效同图receipt稳定选择；SQLite重开；unknown不执行。未改变dot v2一Item一immutable请求，未引入音乐/图像API或真实收费/发布。

- `output/cover-recovery/final-core-tests.log`：16/16。
- `output/cover-recovery/final-independent-probes.log`：5/5；审查报告 `output/cover-recovery/final-review.md` 未留已证实P1/P2。
- `output/playwright/plan-cover-recovery-latest.json`：实际生产React + 隔离SQLite Core、真实本地合成PNG、headless；失败→保存最终歌词→工作室接收→显式选择→重试完成→停止锁定，共五张截图，`operations=0`、`externalRequests=0`、`runState=completed`、`nativeGuiLaunched=false`、`formalDataTouched=false`。文件对话框仅在fixture适配，不能算原生对话框验收。

这两项原本的本地功能缺陷已经修复，不再留作TODO。自动远程再出图不是现有本地恢复的先决条件。

### dot readiness和回执

本地能力已有且经 `tests/plan-dot.test.mjs` 验证：status含requests/associations/blockers/bridgeProjection，桥状态有projected/unchanged/not_configured/disabled/blocked；exact echo、事务关联、封面association、迟到/停止/过期、SQLite关闭重开、owner持久预留及投影冲突恢复均覆盖。UI已有请求、association和桥状态/原因。无需重复实现readiness；随后已完成真实v2请求导出及云端逐字节读回，完整R与回传目录见 docs/integrations/2026-10-19-drive-v2-real-request-handoff.md；剩余是producer实际回传及云端receipt验收。新增directory v2支持仅歌词，无封面资产且不放宽匹配R的outputs范围，详见 dot-delivery-v2-lyrics-only.md。

### 跨版本与独立重开

`scripts/verify-upgrade-compatibility.cjs` 的已有成功报告记录0.8.3-preview.2→0.11.1-preview.1、schema3→3；old-create/new-upgrade/new-reopen为三个独立Electron Node进程。独立 `--reopen-only` 不造新fixture，核对原行/ID/配置/媒体、无新增operation/ledger/run。报告 `networkAllowed=false`、`guiStarted=false`、`realDataRead=false`，所有网络/子进程尝试为0。

reopen-only是**语义只读**：正常PRAGMA/journal初始化可能写入严格隔离root，报告已记录 `isolatedRootMayBeInitialized=true` 与前后DB文件hash；不能说数据库字节绝对不变。选定Core hash对应关系以各报告记录为准，精确最终包验证仍引用包级结果。已实现能力不再列为本地待开发项。

## 尚未通过的最小外部/原生闭环

1. **当前真实内容来源与收费链路**：受信任status核对当前dot channel/bridge/owner后，由实际producer消费固定v2请求并读回云端receipt/本地association；按父任务确认的账户、模型和额度，核对实际评分/音乐原操作和费用。没有授权时保持等待/blocked/unknown，不伪造免费出图或外部任务成功。
2. **真实平台写入与账号环境**：TME生产新建/追加合同、独立albumId与原操作回执、selected ID回读尚需平台可观察校准；非TME适配器和视频链路尚未实现。真实会话持久性、浏览器重开/失效/验证码/切换账号也未通过。CIM权限失败只记录未知，不能绕过或推断没有9222进程。
3. **当前版本正式桌面升级**：候选包与隔离验证不能替代原库快照/正式dataRoot业务数据对照、当前原生GUI与media://播放、同一快捷方式两次调用复用同一实例及回滚验收。当前NoPopup，这些步骤由父任务协调，保持正式pointer未改。

## 正式升级顺序

依 `docs/release/desktop-delivery-policy.md`：

1. 只读记录当前lnk、verified pointer、launcher、实际EXE/dataRoot和作品/素材对照；当前已有 `output/desktop-upgrade-preflight-20261019/` 的lnk/pointer/launcher备份及14组件hash预检。不强关可能有未保存编辑的窗口。
2. 经父任务协调原库权限，对正式SQLite做一致快照和素材备份；不导出凭据、不覆盖旧库，不以程序hash预检冒充原业务数据核对。
3. 核对当前精确commit包及其校验报告；在隔离目录完成schema兼容、原素材可读性和必要验收。当前无可见窗口许可时，原生验收保持待办，不能跳过。
4. 只有必要验收与授权满足后才原子切换verified pointer；保留原dataRoot、同一快捷方式和可回滚旧版，不能指向空candidate-data。
5. 从同一快捷方式实际启动，记录EXE/commit/version/dataRoot、作品ID/数量、音频播放和封面；再次调用应复用同一实例。保留新版本原生证据与回滚位置，未完成不得宣称用户已用上新版。

端到端业务证据应针对同一Plan/Run/Item串起request/hash、实际素材、模型/音乐原操作、选中版本、账号/专辑ID、原发布任务与独立官方回执。隔离通过、历史0.8.3记录或候选包均不得代替这些真实事实。
