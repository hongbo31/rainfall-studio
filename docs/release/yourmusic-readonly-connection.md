# 谱乐只读连接检查

本次只补齐账号设置中已有 API 配置的连接检查。付费音乐生成、模型执行权限、日计划和平台发布仍未启用。

## 合同核验

- 2026-10-16 从官方文档页面引用的位置重新取得 `https://api.yourmusic.fun/v1/openapi.json?lang=zh`（HTTP 200，版本 1.0.0）。当前 Suno custom 模型枚举为 `chirp-v6`、`chirp-v6-wild`、`chirp-v6-mini`，示例为 `chirp-v6`。这是当前合同支持列表，不等于用户账号逐一执行可用性已验证，也不是独立的模型目录响应。
- 同一合同明确 Suno prompt/custom 等提交返回两首歌曲。已遵从用户每次两首的选择，未通过真实生成试探数量。
- 官方公开控制台 `https://api.yourmusic.fun/dashboard` 下发的计费说明写明：生成类在提交成功后扣积分，查询类不扣积分。
- 公开价格说明仅列旧型号：v3-5 为 3 积分，v4/v4-5/v4-5+/v5/v5.5 为 5 积分；没有给出 v6 基础费用。custom 的 Max Mode 另明确“每首 2 倍积分”。因此 **v6 一次两首的准确合计未知，不套用 5 积分或虚构人民币价格**。
- 没有公开的歌曲模型目录、余额或价格 API 出现在当前 OpenAPI。未猜测其他鉴权端点。下一步费用证据须来自供应商明确覆盖 v6、数量与 Max Mode 的报价或控制台价格说明。

可复查的精简合同保存于 `docs/integrations/yourmusic-contract-2026-10-16.json`。本机公开资料原文在 `output/yourmusic-openapi-live-2026-10-16.json`、`output/yourmusic-public-pricing-strings.json`；均不含用户凭据。

## 客户端实现

- 账号设置的谱乐卡片增加“检查连接（只读）”。用户主动点击后，可信顶层 IPC 调用 Main broker。
- Main 验证生产模式、profile ID/revision、provider 和工作区 generation，串行使用已保存的 vault 绑定。
- 唯一请求是 `GET https://api.yourmusic.fun/v1/music/generations/history?page=1&size=1`。客户端无法传入 URL、方法或认证头。HTTPS transport 不跟随重定向，连接前固定检查域名和公网 IPv4，响应有大小与时间限制。
- 历史响应只在 Main 内验证分页结构，作品内容被丢弃。renderer 只得到状态、HTTP 状态码、检查时间及 `authentication_only` 标记。不返回密钥、认证头、歌曲标题/歌词、远端错误原文或原始网络异常。
- 认证成功不代表余额足够、模型调用获批或费用已确认。401、403、402、429、异常响应和网络失败分别显示；不自动重试。保存/清除凭据及配置/模式变化会清除当前页面检查结果。
- 保存 Key 仍不自动联网；不提供读取已保存 Key 的 renderer 接口。未为了连接检查创建新凭据或复制旧凭据。

## 验证

- TDD RED：新增方法和 IPC 不存在，5 项预期失败。
- 凭据与 profile 相关回归：19/19 通过。包含认证/限流/异常响应脱敏、固定 GET、禁止自定义 URL、模式/版本/代际隔离、未提升执行权限，以及 allowlist 故障分类。
- 独立审查没有 Critical/Important，指出非 JSON 响应会丢失状态的 1 项 Minor。新增 transport 回归先 RED 后 GREEN，修复为保留 HTTP 状态、丢弃不可解析正文；关联音乐工作流 9/9 通过。
- `npm run desktop:build`、`npm run typecheck` 通过。
- 同一客户端 HTTPS transport 对官方公开 OpenAPI 的无凭据访问 HTTP 200，合同版本正确。
- 已在正常候选客户端内复用原候选数据目录，安全状态为 configured=true，并于 2026-10-16T11:16:20Z 点击一次只读连接检查。结果为 unavailable / HTTP 未知，不代表 Key 无效，也没有完成认证。未复制凭据，没有付费任务或自动重试。
- 首次响应尚不能区分网络/TLS/输入格式；新增只返回固定 allowlist 类别的 failureCode，既不返回底层异常原文，也不输出认证头。其回归先 RED 后 GREEN。
- 2026-10-16T11:20:49Z 在新诊断候选包中执行一次有针对性的检查，客户端返回 **CREDENTIAL_FORMAT_INVALID**，HTTP 未知。当前固定请求里只有 Authorization 含用户输入，因此该错误指向已保存内容不能构成合法请求头，尚未到供应商认证结果；不能把它误报为服务端 401 或账号无权限。工具没有读取、展示、复制或导出内容。需要用户在当前卡片亲自重新填写 Key 本体、保存后点击只读检查。
- 用户再次要求重试后，2026-10-16T11:39:21.043Z 在同一正常候选版中只点击一次现有“检查连接（只读）”。configured=true，结果为 **认证连接成功 · 生成权限与费用未核验**，此前本地 `CREDENTIAL_FORMAT_INVALID` 没有再次出现。Main 仅在 HTTP 200 且分页结构校验通过时返回 connected，因此网络及服务器认证已通过；200 为根据当前候选源码和 UI 成功状态判定，未直接捕获数值节点。没有重新填写/读取 Key、认证头或历史作品；没有付费生成。脱敏回执为 `output/api-connection-user-retry-result.json`。保存状态标签仍为“已保存 · 未验证”，只读连接成功状态单独展示，不应据此误报当前认证失败。

## 当前可操作候选包

- 源码提交：`835dee12622dab705853bf22a044c261624c3d9f`（此前功能提交 `f298218fc1298260acdee98301cff2678312cf28`）。
- 版本：`0.5.1-api-connection.2`，当前 Main PID 39976，窗口仍在账号设置。
- 包目录：`out/api-connection-835dee12622d-1792149594771`。
- 再次打开使用同级 **Launch-Rainfall.cmd**，其 PowerShell 7 脚本显式复用原候选数据目录 `out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。没有复制凭据或替换桌面快捷方式。直接双击 EXE 的默认目录则是新包自己的空白 `candidate-data`，应避免混淆。
- `output/api-connection-diagnostic-live-result.json` 为固定状态与时间标签回执；没有截图或秘密内容。`output/api-connection-launcher-receipt.json` 记录现有数据根和启动脚本语法校验（0 错误）。
- 三次操作均为用户要求的只读检查：首次测连、第二次按新增类别定位、第三次用户再次要求后重试；没有自动重试、音乐生成、充值或平台发布。

## Electron 调查

原 `0x80000003` 尚未确定根因。此次连接代码没有关闭 sandbox、修改系统 WER、升级或安装运行库，也不把未出现新弹窗视为修复。详情见 `electron-error-investigation.md`。
