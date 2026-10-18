# 最小联调准备补充 · 2026-10-16

## 本次修复

空曲风和空白语种在资料预检、review hash 和保存确认前统一为“流行 / 国语”，与原生表单默认值一致。回归先失败后通过，针对性 30/30、受影响腾讯资料 14/14、类型检查和桌面构建均通过。日志：`output/tme-readiness-focused.log`、`output/tme-readiness-draft-regression.log`。之前暂缓的 Minor 已解决。

## 正常浏览器只读身份核查

使用用户已授权的正常 Chrome/UIA，不启用调试端口、不读 cookie/token 或私有协议。正常地址栏打开 UIA 公开主页链接观察到的 `#/user/musician/index`，再返回此前核实的专辑歌曲列表，展开《从今天起》对应行。

- “我的主页”的可访问链接是通用路径，没有账号 ID；资料页显示艺名和发歌数，未找到可见 UID/音乐人编号。
- “账号绑定”文本的父级是 Document，没有可安全调用的独立入口模式；没有执行绑定/解绑，也没有猜测其他路径。
- 目标专辑有稳定专辑 ID；对应歌曲详情未找到歌曲 ID/作品编号标签或可用的公开 QQ 歌曲身份链接。不能以专辑 ID 充当歌曲 ID。
- 结束时仍有 2 首列表行，UIA 此次无法解析状态，记录为 unknown；历史“审核中”证据不能冒充这次的最新审核结果。

证据位于忽略目录 `output/tme-observation/`：`profile-accessible-destination.json`、`identity-profile-visible.json`、`identity-binding-entry.json`、`identity-song-detail-audit.json`、`identity-final-readonly-state.json`。

尚缺的是：每个写动作前可回读、能区分同名账号的稳定 provider subject，以及当前授权页与具体歌曲/录音的可验证关联。仅一次手输 ID 或艺名确认不足以补齐。这是本次允许查看的页面未核得，不能据此断言全站永远没有 ID。找到正规可见字段/获批接口后再接入其绑定与变更测试；当前不伪造 ID、不解除写入保护。

## 配置位置和此前的谱乐 Key

用户确实曾提供谱乐 Key；本轮没有要求重发、从聊天复制、读取/解密或导出它，也未创建新凭据。

桌面快捷方式调用既有 `RainfallStudioLauncher/Launch.ps1`，当前指针为 **0.5.0-preview.2-229097c93bd7**，数据根目录为 `%APPDATA%/RainfallStudioManaged/data/0.5.0-preview.2-229097c93bd7-2026-10-16T01-35-06-186Z-ff0563a0`。当前包 Main 已有 API credential IPC 前缀，但没有本分支腾讯 live IPC；它与本轮开发候选并非同一版本/数据库。在旧版保存的配置也不会自动同步到候选。

已在该受管数据根和 legacy `%APPDATA%/RainfallStudio` 的配置元数据中核查：API profiles 为 0，对应 credentials 目录 `.bin` 文件数为 0；受管 dataBase 只发现上述一个版本根。在三个已授权项目的常规 data/userdata/.data/production 位置也未找到其他常规用户数据根。没有全盘扫秘密，也没有将隔离 QA 的假配置当成用户真实 Key。该结果不否认用户曾提供，也不判断聊天或其他环境是否另有保存。

本轮候选使用新的独立 `candidate-data`：**账号设置 → API 配置 → API 平台选择“谱乐 AI” → 创建/选择配置 → 本机 Key 输入区**。候选不包含用户 Key；是否重新保存由用户在正常界面自行操作，本轮工具不代填或迁移。原开发启动方式的 `output/manual-tme-preview` 又是另一独立库，不与日用根自动同步。

## 谱乐单首与价格：文档结论

保留的公开 OpenAPI `docs/integrations/yourmusic-openapi-2026-10-15.json`，server `https://api.yourmusic.fun`，对应父会话核对的公开文档入口。`GenerateCustomDto` 没有 count/number 等单首参数；`OpenApiSubmitResponseDto.properties.songs.description` **明确写明 prompt、custom、mashup、sample、extend、cover 一次提交 exactly two songs**。因此不能按现有合同保证仅生成 1 首，也不能把一次请求当作一首。

计费只找到 `is_max_mode` 说明“每首 2 倍积分”；现有 adapter 固定 false。该说明不提供基础每首单价、余额或失败退款规则，文档无相应已核实计费/余额接口。不能用程序中的 fixture_credit/maxCost=2 作为实际资费。当前文档合同与用户“每次 1 首调试”有冲突，需父会话先确认是否接受一次产出两首及费用上限；尚未发起生成。最新服务合同若变化，需以当前正式文档校对后再调适配器。

## 独立候选

目录：`out/tme-readiness-f98b20328ab4-1792145753240/`，入口 `RainfallStudioCandidate.exe`，源码提交 `f98b20328ab4707a1f30b32cfd5674bc32fdf341`。

使用已安装 Electron 和已有 production 依赖离线复制，不下载安装、不注册或替换桌面。保持整个目录，不能只复制 EXE；默认数据位于目录内 `candidate-data`，未导入日用数据或凭据。它是用于后续配置和联调的开发候选，生成和腾讯真实写入仍需上述条件及授权，不宣称已完成完整链路或 GUI 验收。

候选无窗口 smoke 已通过：实际候选 EXE 以 Electron Node 模式加载 SQLite 内存库、Core、Sharp，并检查 API credential / 腾讯 live IPC 和隔离默认路径；没有创建候选用户数据。记录 `output/tme-candidate-headless-smoke.json`。没有运行或声称完成候选 GUI 验收。运行条件仍包括 PowerShell 7（只读 UIA）和整个候选目录，不是安装程序。
