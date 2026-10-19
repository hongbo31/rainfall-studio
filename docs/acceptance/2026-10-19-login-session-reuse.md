# 音乐平台登录态复用审计（2026-10-19）

范围：当前 `0.11.1-preview.1` 独立候选源码、配置结构、既有脱敏验收报告，以及本机明确9222浏览器的受限进程元数据查询尝试（CIM失败，没有取得实际字段）。没有读取浏览器 profile 内容、Cookie、凭据文件或真实业务数据库；没有启动/重启真实账号浏览器、连接9222、导航现有主标签、真实扣费、上传、接受协议或发布。修复验证仅启动临时的**无头本地组件夹具**，不接触真实账号或平台。

## 可直接回复用户

当前腾讯音乐链路的代码复用这台电脑上已经开启调试的 Chrome/Edge：客户端只连接 `127.0.0.1:9222`，不会每次新建临时浏览器配置，所以客户端本身不会主动要求每次扫码。但本次进程元数据查询受限，没能确认当前9222浏览器实际用了稳定目录还是临时配置。客户端重启后要重新连接、核对一次官网账号；如果原浏览器仍在、同一配置中的登录仍有效，可以继续复用。浏览器关闭后是否还能保持登录，由你下次打开的浏览器配置和平台会话决定，目前没有做这轮真实重启验收，不能承诺永不重新登录。

网易云、汽水等本地“账号资料”目前只是平台/艺人/任务的记录，并没有自动绑定到各自浏览器环境或接通登录复用。谱乐 YourMusic 则使用保存的 API Key 和 API 配置，不等同于 Suno 官方或发行平台的网页登录。已修正界面：明确连接不代表登录，显示最近核对时间；本地观察超过5分钟、会话变化、断线或核对失败会清除旧账号显示。5分钟是客户端观察的新鲜度期限，不是平台登录的实际到期时间。

## 能力结论

| 问题 | 源码与证据支持的结论 | 限制 |
|---|---|---|
| 是否每次启动临时 profile 导致扫码 | 产品 `src/`、`desktop/`、`launcher/` 检索无 `chromium.launch`、`launchPersistentContext`、`userDataDir`、`storageState`、Cookie读取；实际产品通过 `connectOverCDP(...noDefaults:true)` 附加 | 开发/QA脚本确实可创建自己的隔离测试环境，不能把测试环境等同日用账号环境；本轮CIM查询失败，未取得实际浏览器进程/profile路径，不能排除用户当前连接的浏览器本身为临时profile |
| 已登录9222浏览器是否复用 | 按用户点击连接现有端点，发现接口与WebSocket限定相同的 `127.0.0.1` 端口，不启动、重启或配置浏览器；必须恰好一个腾讯官方页面 | UI当前固定9222；Main可接受显式端口，但没有自动扫端口、profile选择器或多个账号并行连接 |
| `cloud-playwright` 是否云账号 | 这是 Main 内部的传输/绑定类型；实际入口是本机 loopback CDP，来自用户已准备的现有浏览器会话 | 不代表 ChatGPT、dot 或远端云电脑账号，不提供跨机器登录迁移或自动 cloud session 供应 |
| 客户端重启 | Main的 browser/page/账号指纹只驻内存；启动、Core重启、模式切换、备份恢复、退出均断开或撤销当前绑定；新连接生成新的 sessionId/pageId | 重启后需显式重连；旧任务授权中的会话绑定不能因“仍是同一账号”自动恢复。浏览器登录可以仍有效，但这是另一层状态 |
| 浏览器重启 | 客户端未拥有或保存浏览器 profile，也没有自动重启浏览器的代码 | 需用户以同一持久浏览器配置打开并保留/开启原端点；浏览器/平台若清理登录态、风控或要求验证，仍需本人处理。本轮未验证真实浏览器重启 |
| 是否逐平台绑定同一环境 | 当前仅一个腾讯 CDP manager；QQ/酷狗可作为同一个TME账号家族使用。网易/汽水/抖音没有对应专辑执行适配器 | 本地 accountId 不选择浏览器 profile，也不会自动换到指定真实账号。无现成的“每平台每账号→固定持久profile”映射 |
| 账号唯一性 | 官方绑定页读取唯一可见艺人、QQ绑定名、酷狗ID；两处酷狗ID必须一致；三者组成 SHA-256 指纹；后续 fresh read 与已固定指纹核对 | 类型明确为 `official_visible_binding_fingerprint`，不是 OAuth/Tencent UID 证明；QQ昵称、艺名变更也会保守拒绝，不能仅靠首页艺名判断账号 |
| 登录失效 | CDP存活只说明浏览器连接；实际账号核对/业务操作需重新读取官方身份，缺失、隐藏、重复、账号切换或来源变化会拒绝 | 没有读取平台token到期时间，也不持续后台导航官网以探测过期。登录失效、绑定缺失、验证码或页面变化有时共用“身份未核实”错误，不能伪称已经精确诊断登出 |

当前时点已有真实只读证据：`output/album-pagination/official-readonly-proof.json` 记录 2026-10-19 05:57:54–05:58:12 UTC，官方目录已发布3/未发布0、待发布引用0，`primaryPreserved=true`、`backgroundTargetsOnly=true`、`realPlatformWrites=0`。这是**该时点已有登录会话的只读成功**，不是当前候选客户端/浏览器实际退出重开后的登录持久性证明。

历史 `docs/release/real-browser-account-acceptance-result.md` 记录2026-10-18独立Edge用户亲自登录、候选显示脱敏账号，最后正常关闭本次Edge并保留独立配置；不证明本轮Chrome与该Edge使用相同profile或账号。本审计不沿用其PID、窗口句柄、profile路径或真实ID。

## 本机浏览器环境元数据尝试（真实、只读，未成功取得字段）

2026-10-19 06:27:38 UTC执行限定查询；补充不含原始错误文本的阶段/异常类型诊断后，于 **06:27:59.5378174 UTC**重试，仍失败。查询范围是 `Win32_Process` 中仅名称为 `chrome.exe`/`msedge.exe` 且命令行明确包含 `--remote-debugging-port=9222` 的候选；查询属性仅 `ProcessId`、`Name`、`CommandLine`。完整命令行只计划用于内存筛选，排除带 `--type` 的子进程并提取白名单flag，绝不序列化原命令行。

允许的结果字段只有PID、exe名、端口、`--user-data-dir`、`--profile-directory`、incognito/guest布尔，以及目录 `Get-Item` 得到的存在性、目录类型、LinkType和路径自身是否含Temp/QA命名片段。即使目录稳定，也不等于平台token持久。没有读取其他启动参数、目录内容或猜测默认profile路径。

**实际结果：CIM查询阶段失败，异常类型 `CimException`，状态 `cim-unavailable-or-access-denied`。** 未取得PID、profile或其他实际进程字段，因此也没有执行后续目录元数据检查。这里的空 `processes:[]` 表示查询失败，**不表示没有9222进程**。现有信息不能区分CIM不可用和权限拒绝的具体原因；未升权或改用其他途径绕过。

脱敏原始结果：`output/login-session-audit/browser-environment-metadata.json`；可复查的受限脚本：同目录 `browser-environment-metadata.ps1`。文件中不含实际完整命令行、Cookie或凭据。当前profile是否在Temp、是否带随机QA前缀、是否处于无痕/访客模式均仍**未知**。没有关闭、重启、连接、导航或迁移现有浏览器，没有创建profile或复制Cookie。后续若获准在有权限的本机环境重跑该只读检查，仍须保留此范围；当前不能将profile稳定性列为通过。

## 数据根、账号记录与API环境

1. `src/main/data-root.ts` 优先使用 `RAINFALL_DATA_ROOT`，其次 `RAINFALL_PREVIEW_DATA_ROOT`，最后应用数据目录下 `RainfallStudio`。`bootstrap.ts` 把 Electron `userData` 放在 `<root>/runtime`，Core以同一个root和mode启动，凭据vault结构在 `<root>/credentials`。这是客户端自己的环境，**不是外部Chrome/Edge配置目录**。
2. 正式入口源码 `scripts/Launch-Verified.ps1` 从权威 `verified-desktop.json` 验证并传入显式dataRoot，复用已验证同一窗口；候选打包默认指向该包的 `candidate-data`。直接启动另一个候选包可能显示空的本地账号/API配置/作品库，原因是数据根不同，不应通过复制凭据或Cookie“修复”。本轮只读了脚本结构，没有读取实际指针内容或库。
3. `src/core/inbox/headless-host.ts` 是限时、无窗口的dot收件宿主，要求绝对 `--data-root` 和 `--project`，同一root有workspace lease。它没有浏览器连接、vault/API调用、模型/音乐/发布tick，`cloudTransportVerified:false`，`accountIdentity`明确为用户确认、邮箱未独立验证。不能把这个host在线解释为音乐平台已登录或自动创作全部在运行。
4. `account.save` 创建的 `remoteSubject:null`、`authStatus:not_connected` 与艺人绑定只是本地资料。只读“核对官网账号”不会写这些账号。当前可信的 scoped preparation grant 注册才可能把尚未绑定的本地TME账号填入观察到的subjectHash，已有不同指纹会拒绝；不能把“点击核对”说成永久绑定账号/profile。专辑Core scope要求本地 `remoteSubject`，Main再比较实时账号指纹；缺少映射会报 `ALBUM_ACCOUNT_IDENTITY_REQUIRED`，不自动猜号。
5. YourMusic的持久选择是 API profile UUID/provider/revision；vault按profile UUID存储，绑定 `providerId` 和 `local-profile:<id>`，Main校验模式/代际/revision后使用。保留相同dataRoot、profile UUID和可用的系统加密环境可找到原Key；不同电脑/系统用户的解密能力不作保证。`stored_unverified`只说明保存状态。固定只读历史检查200且响应结构正确才返回 `connected`；401/403/402/429分别对应未认证/权限/积分/限流。这个检查没有提供远端用户ID，因此也不能独立证明多个本地profile到底对应几个供应商账号。
6. 谱乐API的模型名称即使含Suno，也不等于在 `suno.com` 登录，不会获得网易、汽水或TME发行权限；官网“打开官方页面”只是交给系统默认浏览器打开URL，没有指定其profile，也不自动将该浏览器接到9222。

主要依据：`src/main/bootstrap.ts`、`src/main/data-root.ts`、`scripts/Launch-Verified.ps1`、`scripts/package-tme-candidate.mjs`、`src/core/inbox/headless-host.ts`、`src/core/studio.ts`、`src/core/tme-ai-prepare-integration.ts`、`src/core/plan-albums.ts`、`src/main/plan-albums.ts`、`src/core/api-profiles.ts`、`src/main/api-credentials.ts`、`src/main/credentials.ts`、`src/shared/api-profiles.ts`。仅检查结构与实现，没有访问vault中的数据。

## 本轮必要修复

根因是 `PublicationBrowserConnection` 原来把一次账号观察显示为“已核对”，只轮询CDP/页面存活；官网登出但CDP仍存活时，旧显示可无限保留，不能让用户分清连接与登录。

仅修改 `src/renderer/components/PublicationBrowserConnection.tsx` 和 `tests/browser-account-ui.test.mjs`：

- 连接文案改“浏览器已连接（连接不代表登录）”。
- 账号显示改“最近核对”，可见核对时间；读回缺少/非法/过于未来/已过期的时间不能作为有效观察。
- 本地观察5分钟到期即清除，提示重新核对。页面会话更换、断线、Main状态返回失败/异常均清除旧观察；组件重新挂载不恢复旧观察。
- 人工核对失败分别说明“官网账号已变化”“浏览器会话不可用”“官网登录或账号身份未核实”等，不把CDP连接失败误说成账号认证失败，也不把验证码/DOM变化断言成确定登出。
- 轮询仍只调用Main `browserStatus`；到期不触发官网身份读取/导航，不强制登录，不新建持久profile，不复制Cookie。每次实际账号检查仍由用户点击；Main业务身份检查保持原逻辑。

五分钟仅是**界面观察期限**。期限内也可能发生登出/换号；界面不提供持续登录保证，业务必须继续使用自己的fresh identity校验。生产上传/新建/追加/提交门禁没有因该修复改变。

## 验证与剩余验收

先新增时间完整性与真实DOM显示断言，修改前2/2失败：缺少timestamp拒绝、找不到连接/登录区分文案；修改后通过。

| 验证 | 结果 | 证据 |
|---|---|---|
| 无头本地组件UI + cloud manager + 发布render | 21/21通过 | `output/login-session-audit/targeted.log` |
| 其中组件2项 | 时间显示；5分钟过期不新增inspect请求；会话更换、重挂载、断线、状态失败清除；身份/连接错误区分；无准备/提交按钮 | `tests/browser-account-ui.test.mjs` |
| 其中cloud manager10项 | 启动不连；显式许可；loopback校验；唯一官方页面；身份变更/重复/隐藏拒绝；断线/重连旧binding失效 | `tests/tme-ai-cloud-session.test.mjs` |
| 项目默认测试 | 3/3通过 | `output/login-session-audit/npm-test.log` |
| TypeScript检查 | 通过，exit 0 | `output/login-session-audit/typecheck.log` |
| 本次变更diff whitespace | 通过 | `git diff --check -- src/renderer/components/PublicationBrowserConnection.tsx tests/browser-account-ui.test.mjs` |
| 当前9222浏览器进程/profile元数据 | **CIM查询失败，实际字段未知**；无浏览器/文件内容操作 | `output/login-session-audit/browser-environment-metadata.json` |

本轮没有复跑全量38组，也没有真实账号重启/登出/扫码/验证码测试；上述21项是有重叠的既有与扩展测试，不与其他分组合计为独立总数。没有构建/安装/切换正式包或桌面指针，UI修复须由父任务纳入最终构建。

仍需在适当授权与原生验收环境中分别验证：①当前同一浏览器与profile保持运行、客户端退出重开后重连核对；②浏览器正常退出再以同一profile重开后是否仍登录；③登出、验证码、平台会话过期与切换账号时真实页面反馈；④正式入口二次启动的EXE/dataRoot/API profile一致性。未完成这些步骤前应标记“现有会话复用代码与隔离负例通过、真实重启持久性未验证”，不能列成全平台无人值守登录通过。
