# dot 计划请求与 Google Drive 交付协议

核对基线：2026-10-19，仓库 HEAD `d7d90d2`。本文件可单独交给父会话实现外部 producer。**请求投影 v2 是本地文件协议，不是 dot 触发 API**；实际 dot 执行、云端读取与投递由父会话协调。本文不授权生成音乐、发布作品或设置日程。

## 1. 两个方向与固定目录

`P` 是已由可信本地配置选择的同步项目目录，`I = <dataRoot>/<mode>/inbox-v1`。输入 JSON 不能指定或改变这些路径。

```text
P/
  requests/plan-requests-000000000001-<contentHash>.json  Rainfall → producer
  requests/plan-requests-000000000002-<contentHash>.json  下一份不可变快照
  incoming/<deliveryId>/                               producer → Rainfall
    text.json
    cover-<imageSha256>.png                            或 .jpg / .webp
    manifest.json
    READY.json                                        最后提交
  receipts/<deliveryId>.json                           Rainfall → producer

I/
  requests/plan-dot-requests.json                      显式本地导出；不是云端 HEAD
  incoming/<batchId>.json                              旧/直接文本入口，包可为 v1 或 v2
  receipts/<batchId>.json                              文本导入回执
  processed/  rejected/                               直接文本入口的归档与错误
  bridge-staging/<uuid>/                              私有中转，不是 producer 目标
  deliveries/<deliveryId>/                             验证后私有交付副本
  delivery-receipts/<deliveryId>.json                   私有文本+封面回执
  delivery-receipts/<deliveryId>.error.json             私有永久错误
<dataRoot>/media/sha256/<前两位>/<imageSha256>.<ext>       内容寻址的实际封面
```

Drive `P/incoming` 接收**交付目录**，不是散放的 `<batchId>.json`。只有 `I/incoming` 接收直接文本文件。Bridge 先验证整个云盘包，原子提升到私有 `deliveries`；Receiver 再校验、落媒体、提交候选/草稿/封面/回执；最后将数据库中已提交的交付回执写到 `P/receipts`。源文件保留。各层 `cloudTransportVerified:false` 是实现的能力声明，不能据此声称云端同步成功。

## 2. 请求 R：不可变、精确回显

以下 R 的 `requestHash` 已按本文算法计算；它是离线格式示例，不是可投递的真实请求（本机必须存在同一保存请求与通道映射）：

```json
{
  "requestVersion": 2,
  "requestId": "req-example-001",
  "requestHash": "fd21302c3e6f7893e4e306de101c021733156b755b03443c99f13ee8d4a2f201",
  "planId": "plan-example", "planRevision": 1,
  "runId": "run-example", "itemId": "item-example", "ordinal": 1,
  "profileIdentity": "creator", "channelId": "channel-example",
  "workspaceId": "workspace-example", "workspaceRef": "rainfall-personal",
  "artistId": "056f056b-9500-4e2c-8111-886c9fd958f7", "artistRef": "creator",
  "expectedExternalItemId": "dot-example-001", "revision": 1,
  "outputs": { "lyrics": true, "cover": true, "music": false },
  "brief": { "title": "Example", "theme": "Rain", "styleTemplate": "Quiet" },
  "createdAt": "2026-10-19T00:00:00Z", "expiresAt": "2026-10-26T00:00:00Z"
}
```

`requestVersion` 只能为 2；上述字段全部必填，未知字段拒绝。一般身份字符串长 1–500；requestId/expectedExternalItemId 使用下述 InboxId。planRevision、ordinal 正整数，revision 为 1–1,000,000；brief 三字段最大 200/2,000/4,000 字符，允许空串。时间为带时区 ISO datetime，expiresAt 必须晚于 createdAt。

请求只为 dot 来源的活动 run 创建，要求本地通道 ID 等于计划 material.channel，`artistRefs[material.identity]` 等于该 run 的 artistId；否则报告 `DOT_CHANNEL_IDENTITY_REQUIRED`。每个 item 只分配一次请求；重启、导出、停止均不重写 R。expiresAt 为 run.createdAt 加 7 天。revision 在数据库写锁内按 **channelId + expectedExternalItemId** 取所有历史请求与已导入候选的最大版本加一，包含停止、过期和未消费请求；不回收版本，超过上限报告 `DOT_REVISION_EXHAUSTED`。

### 哈希算法

`C(v)`：对象键按 JavaScript `Object.keys(v).sort()` 递归排序；数组保留原顺序；原始值用 `JSON.stringify`；连接成无空白 JSON；不 trim、不改大小写、不做 Unicode 归一化。`H(v) = SHA256(UTF8(C(v)))`，小写 64 位十六进制。`requestHash = H(R 去掉 requestHash 字段)`。hash 是完整性绑定，不是签名或 producer 身份认证。

文件字节哈希与 H 不同：manifest/text/image SHA256 均直接对文件的最终原始字节计算；改换行、BOM 或缩进就必须重算其文件哈希。所有 JSON 用严格 UTF-8，建议无 BOM。

## 3. requests 投影 v2 与 producer 消费规则

投影文件的完整顶层结构如下（尖括号字符串是说明占位符，不能直接投递；R/A 指本文请求/关联对象）：

```json
{
  "projectionVersion": 2, "producer": "rainfall-plan-center",
  "protocolVersion": 2, "transport": "local-files",
  "ownerId": "<持久化 UUID>", "projectionSequence": 1,
  "channelId": "<通道ID>", "workspaceId": "<工作区ID>", "workspaceRef": "<工作区别名>",
  "requests": [], "associations": [],
  "requestStates": [{ "requestId": "<R.requestId>", "state": "pending" }],
  "contentHash": "<H(整个投影去掉contentHash)>"
}
```

实际 requests 是完整 R 数组；associations 是完整 A 数组；requestStates 对每个请求提供状态。projectionSequence 正整数、最大 999,999,999,999，文件名为 12 位补零序号加该 contentHash。投影最大 8 MiB。快照按当前 channelId/workspaceId/workspaceRef 过滤；旧请求不会因为被停止或消费而消失。

producer 必须：

1. 通过父会话已确认的项目目录及通道绑定信任一个 ownerId；不能从任意新文件自认 ownership。扫描并验证文件名、严格 schema、contentHash、每个 R.requestHash 与通道范围。只选同一受信 owner 的**最高完整有效序列**；同步中不完整的新文件等待重试，不依据 mtime 或日期选包。已见更高有效序列后不回退。相同 owner+sequence 出现不同内容视为冲突。
2. 只启动该最新投影中 `requestStates.state === "pending"` 的请求，并校验当前时间未达 expiresAt。投影不是排他任务领取服务；父会话应安排单一 producer，或另行协调去重。
3. 在生成前持久记录 `(ownerId, requestId, requestHash)` 与工作状态，给该请求固定 batchId、deliveryId 和最终交付字节。只重试同步/投递，不因缺回执自动重新生成。相同 requestId 换 hash 为冲突；生成状态未知时先查自己的工作记录及 receipts。
4. 生成并提交前重新读取最新完整投影；看到 stopped/expired/consumed/terminal 就不再启动生成。已完成或已在途包仍可收到回执，按第 6 节处理。
5. 用 R 的 expectedExternalItemId/revision/artistRef/workspaceRef 交付，并在每个 v2 item 中逐字段精确复制完整 R 到 `requestEcho`；不得重建时间、简化字段、修改 outputs/brief 或填自己的 requestHash。

状态优先级为：run 请求停止/已停止 → `stopped`；已过期 → `expired`；run 缺失或 completed/failed → `terminal`；已有该请求关联 → `consumed`；否则 `pending`。consumed 不等于已评分/音乐/发布成功，关联可能仍是 received。

Rainfall 先将 owner/sequence/快照 reservation 独立持久提交，再独占发布新文件；已有 generation 永不覆盖，无内容变化时复用原文件。没有可覆盖的 HEAD。预存 `plan-requests*.json` 但本地无对应 owner 记录、受信来源不符、文件内容冲突、配置变更、链接/目录越界均阻止投影。显式导出 `I/requests/plan-dot-requests.json` 的顶层为 `{protocolVersion:2,transport:"local-files",exportedAt,requests,associations}`，会替换本地导出文件，**不是上述云盘 generation 格式**。

## 4. producer 返回：Inbox v2 文本 + delivery v1 封面包装

以下 text.json 是完整的离线格式示例，requestEcho 与上面的 R 相同。实际投递必须复制真实保存请求、替换相应身份，并填入真实创作内容；此示例不对应本机已保存请求。

```json
{
  "schemaVersion": 2,
  "batchId": "dot-example-delivery-001",
  "createdAt": "2026-10-19T00:05:00Z",
  "targetWorkspaceRef": "rainfall-personal",
  "items": [{
    "externalItemId": "dot-example-001", "revision": 1, "parentRevision": null,
    "artistRef": "creator", "seriesRef": null,
    "requestEcho": {
      "requestVersion": 2, "requestId": "req-example-001",
      "requestHash": "fd21302c3e6f7893e4e306de101c021733156b755b03443c99f13ee8d4a2f201",
      "planId": "plan-example", "planRevision": 1, "runId": "run-example", "itemId": "item-example", "ordinal": 1,
      "profileIdentity": "creator", "channelId": "channel-example",
      "workspaceId": "workspace-example", "workspaceRef": "rainfall-personal",
      "artistId": "056f056b-9500-4e2c-8111-886c9fd958f7", "artistRef": "creator",
      "expectedExternalItemId": "dot-example-001", "revision": 1,
      "outputs": { "lyrics": true, "cover": true, "music": false },
      "brief": { "title": "Example", "theme": "Rain", "styleTemplate": "Quiet" },
      "createdAt": "2026-10-19T00:00:00Z", "expiresAt": "2026-10-26T00:00:00Z"
    },
    "draft": {
      "title": "Example", "topic": "Rain", "storyBeat": "A walk home in the rain",
      "language": "en", "style": "Quiet pop", "instrumental": false,
      "sections": [{ "id": "chorus", "kind": "chorus", "lines": ["The rain will guide me home"] }],
      "hook": { "sectionId": "chorus", "startLine": 0, "endLine": 1 },
      "vocalPlan": [{ "sectionId": "chorus", "voice": "female" }],
      "musicPrompts": {
        "suno": { "positiveStyle": "Quiet pop", "negativeStyle": "", "durationTarget": 120, "voiceArrangement": "female" },
        "yourmusic": { "positiveStyle": "Quiet pop", "negativeStyle": "", "durationTarget": 120, "voiceArrangement": "female" }
      },
      "continuityNotes": ""
    },
    "provenance": { "producer": "dot", "model": null, "promptVersion": null, "generatedAt": "2026-10-19T00:05:00Z" }
  }]
}
```

InboxId = `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`，禁止大小写不敏感 Windows 设备名 con/prn/aux/nul/com1–9/lpt1–9。batchId/deliveryId/externalItemId 均用此约束，建议统一小写并始终保留首次拼写。items 1–20；单包不重复 externalItemId+revision，也不重复 requestId。JSON 文件 ≤1 MiB；unknown 字段拒绝。parentRevision 为 null 或小于 revision 的正整数；不存在的父版本可先导入为 lineage_pending，父版本到达后补齐关系。artistRef/seriesRef 只能用本地已映射别名，seriesRef=null 不需要系列映射；映射不能跨艺术家。

draft 的 title/topic/language/style、section id/kind 为 trim 后 1–500 字符；storyBeat 1–10,000；sections ≤100，各 lines 1–100 行、每行 ≤1,000 字符，section id 不重复。instrumental=false 要求至少一个 section 且 hook 非 null；hook 是已有 section 内的 `[startLine,endLine)`，start≥0，end>start 且不越界。instrumental=true 要求 sections=[]、hook=null、vocalPlan=[]。vocalPlan≤100 且 sectionId 存在。voice/voiceArrangement 只能 male/female/duet/ensemble/instrumental。两个 musicPrompts 对象均必需：positiveStyle 1–10,000，negativeStyle 0–10,000，durationTarget 为 10–1,800 整数。continuityNotes≤10,000。provenance.producer 1–100，model/promptVersion 必填但可 null（非 null ≤200），generatedAt 带时区。

manifest.json：

```json
{
  "deliveryVersion": 1, "deliveryId": "dot-example-delivery-001",
  "createdAt": "2026-10-19T00:05:00Z", "targetWorkspaceRef": "rainfall-personal",
  "text": { "file": "text.json", "sha256": "<text.json原始字节SHA256>" },
  "images": [{
    "externalItemId": "dot-example-001", "revision": 1, "role": "cover",
    "file": "cover-<imageSha256>.png", "sha256": "<imageSha256>",
    "bytes": 12345, "mimeType": "image/png", "width": 2048, "height": 2048,
    "provenance": { "producer": "dot", "model": null, "generatedAt": "2026-10-19T00:05:00Z" }
  }]
}
```

READY.json（大小写按此文件名）只有：

```json
{ "deliveryId": "dot-example-delivery-001", "manifestSha256": "<manifest.json原始字节SHA256>" }
```

所有尖括号均应替换为实际小写 64 位 hex；bytes/尺寸填真实值。一个 text item 必须有且仅有一个同 externalItemId+revision 的 cover，images 1–20，不能重复文件名（大小写不敏感）或封面身份。封面只能 PNG/JPEG/WebP 静态图片；文件名精确为 `cover-<sha256>.png|jpg|webp`，JPEG 必须 .jpg。每张 1–20 MiB、单轴≤10,000、总像素≤25,000,000；尺寸正整数。接收器验证 SHA/大小/MIME/尺寸并完整解码，拒绝动画与损坏图片。manifest≤64 KiB、READY≤4 KiB。目标工作区别名长 1–80。即使请求 outputs.cover=false，**当前 directory delivery v1 仍强制每项一个封面**；文本单独交付只能走私有文本入口，不能把只有 text.json 的目录放进 Drive incoming。

写入规则：先在非最终目录或唯一 .partial 文件准备全部最终字节，依次提交 text、封面、manifest，最后 READY；最终目录名等于 deliveryId。同步到达可能乱序，READY 存在也不代表完整。已提交包保持不可变，重传必须保持 ID、内容与 hashes；不要原地修补已接受的 deliveryId。修正被永久拒绝的包由父会话协调新 deliveryId/batchId；若同 item identity 内容改变，也需新的合法版本/请求。

可核对仓库 `docs/integrations/dot-delivery-example/` 的完整字节有效 v1 fixture（64×64、237 字节紫色图片）；它是格式样本，不是 dot 创作或计划 v2 验收。

## 5. receipts、关联与幂等

Drive 交付回执 `P/receipts/<deliveryId>.json` 在元数据事务提交后生成：

```json
{
  "receiptVersion": 1, "deliveryId": "dot-example-delivery-001",
  "manifestSha256": "<实际manifest字节hash>", "batchId": "dot-example-delivery-001",
  "workspaceId": "<配置中的workspaceId>", "importedAt": "<带时区ISO时间>", "status": "imported",
  "items": [{
    "externalItemId": "dot-example-001", "revision": 1,
    "candidateId": "<本地ID>", "draftId": "<本地ID>",
    "coverAssetId": "<本地ID>", "coverSha256": "<实际图片hash>", "evaluationState": "model_pending"
  }]
}
```

producer 必须云端重新读回并匹配 deliveryId、manifestSha256、batchId、workspaceId、完整 items identity 与 coverSha256；文件存在或本地写入不算云端确认。该回执**没有 requestId/requestHash，也没有 attached 状态**：producer 用自己的固定 deliveryId→requestId 台账关联；计划归属另查最新投影 associations。导入仅代表接收和结构/媒体验证成功，evaluationState 始终 model_pending，不表示模型评分、音乐生成、平台发布或费用发生。

文本入口回执字段不同：`{receiptVersion:1,batchId,packageHash,workspaceId,importedAt,status:"imported",items:[{externalItemId,revision,draftId,candidateId,status:"imported"|"existing",evaluationState:"model_pending"}]}`。packageHash=H(原始完整包)。相同 batch 重放返回原始已持久回执；换 batch 导入同一未改 item 可得 existing。

关联 A 的完整字段为 `{requestId,requestHash,planId,runId,itemId,candidateId,draftId,externalItemId,revision,channelId,artistRef,protocolVersion:1|2,status:"received"|"attached"|"stopped"|"expired"|"late",late:boolean,receivedAt}`，可选 coverAssetId、coverSha256、reason（≤500字符）。关联按 requestId 持久保存，candidate 不会分给另一个请求；后到的首个精确封面只补充原关联，不重新 attach/评分。received 可表示 attach 被阻塞，reason 和 blockers 说明原因。

| 身份与范围 | 同内容重试 | 不同内容 |
|---|---|---|
| batch：channelId + batchId.toLowerCase() | 原 receipt、原 IDs | INBOX_IDEMPOTENCY_CONFLICT |
| item：channelId + externalItemId + revision（externalItemId区分大小写） | 原候选/草稿 | INBOX_IDEMPOTENCY_CONFLICT |
| delivery：channelId + deliveryId.toLowerCase() | 同 manifestSha256 返回原 receipt | DOT_DELIVERY_IDEMPOTENCY_CONFLICT 或 bridge private conflict |
| cover：item identity | 同 SHA/版本复用，媒体按 SHA 复用 | DOT_DELIVERY_COVER_REVISION_CONFLICT |
| project receipt：同 deliveryId 文件 | 内容相同保留 | DELIVERY_BRIDGE_RECEIPT_CONFLICT，绝不覆盖 |

事务覆盖候选、草稿、封面关系、资产元数据和回执；任一步失败整体回滚。媒体字节可能因崩溃先存在，后续按 hash 安全复用。提交后回执写盘失败会从数据库重建，重启无需再次生成作品。单次扫描最多 100 个变化交付，不因旧成功包阻塞后续积压。

缺文件/字节 hash 尚未对齐/文件变化/临时 IO 进入 waiting，以 30秒、1分、5分、15分封顶退避。永久 schema、范围、图片或身份冲突进入 rejected；私有 delivery-receipts 可有 `.error.json`，bridge 也记录 waiting/rejected/receipt_waiting。**实现不保证将拒绝错误同步到 P/receipts**，因此无成功回执时查本地状态，由父会话处理，不能据此盲目重新生成。路径各级拒绝 symlink/junction；常规文件拒绝硬链接。Drive 虚拟卷 nlink=0 只在 Windows 原生卷序号匹配且 flags 证明不支持硬链接时接受。

## 6. v1、停止与迟到边界

Inbox v1 与 v2 的 envelope 相同，v1 无 requestEcho；v2 必需精确完整 requestEcho，格式错误不能回退解释为 v1。v2 导入核验本地保存请求、R hash、channel/workspace/artist/externalItem/revision 全部一致，否则 DOT_REQUEST_ECHO_MISMATCH / HASH_MISMATCH / SCOPE_MISMATCH，整包回滚。

v1 仍可导入。自动关联要求同一 channel/工作区/艺术家/外部 ID/版本精确命中，且该身份在**所有历史请求中只有一个可能 owner**；旧 custom ID 被多个 run 重用时，即便版本不同也不能靠 v1 猜所属 run，报告 DOT_LEGACY_AMBIGUOUS。新 producer 一律使用 v2。

停止计划 run 不取消云端模型调用，也不抹掉已发 R。停止、过期、completed/failed 后收到精确包，仍可导入、保存候选和回执，并保留原请求关联：停止优先 status=stopped，其次 expired，其次 terminal 为 late，late=true；不会 attach 或重开原 run。新的 v2 run 复用外部 ID 时使用更高 revision、独立 requestId/echo；旧迟到包只归旧 run。收件器自身 pause/bridge pause 会取消在途解码并阻止私有提升/导入，恢复后才继续，这与停止单个计划不同。

## 7. 既有 Drive 证据与尚缺条件

只读已记录证据 `output/dot-drive-connected-20261018/connection-evidence.json`：历史 P 为 `G:\我的云端硬盘\Rainfall Studio\dot-delivery`，incoming/receipts 已存在，绑定 workspaceRef=rainfall-personal、artistRef=creator、seriesRefs={}；当时正常用户可访问而受限 token 不可访问。历史身份映射不等于当前运行配置；不要凭盘符复用其他机器绑定。

本次获准按该记录提取精确 P，2026-10-19 **04:58:01 UTC** 在正常用户上下文仅用 Test-Path/Get-Item 检查固定路径属性（先前受限 token 对四处均返回 Access denied，不能将其解释为目录不存在）：

| 精确路径 | 当前结果 |
|---|---|
| `G:\我的云端硬盘\Rainfall Studio\dot-delivery` | 存在；Directory；LinkType/Target 均 null |
| `G:\我的云端硬盘\Rainfall Studio\dot-delivery\incoming` | 存在；Directory；LinkType/Target 均 null |
| `G:\我的云端硬盘\Rainfall Studio\dot-delivery\receipts` | 存在；Directory；LinkType/Target 均 null |
| `G:\我的云端硬盘\Rainfall Studio\dot-delivery\requests` | 不存在（正常完成检查，无访问错误） |

**当前结论：已有本机物料 incoming/回执 receipts 目录可供受信配置复用；当前没有现成 requests 目录，不能声称请求投递路径已经就绪。** 代码能在启用且可信的 bridge 配置下创建 requests 并发布 generation，但本次明确没有创建目录或文件、没有测试写权限，也没有触发 producer。属性存在不证明云端同一文件夹的读写权限或同步状态。本次未广搜目录、未读云盘内容、未调用云端 API/浏览器。代码中的 inbox-channel/inbox-bridge 是本地 settings 记录，不是协议定义的独立 marker 文件；未提供独立 marker 的精确路径，本次没有猜测路径或打开数据库。

后续 `real-dot-acceptance.json` 与 `cloud-receipt-readback.json` 记录旧源码 227738d 的一次真实包 `dot-delivery-20261019-001`：文本/封面导入，云端 receipt 回读匹配，重启/重扫无重复，works=0、operations=0。它证明当时 incoming→私有接收→receipts→云端回读成立；早期 checkpoint 中“真实包尚待验收”已由该后续记录补齐。

当前 requests v2 的代码出口具备，本次固定路径检查已确认 P/requests 不存在；没有读取原业务 DB、凭据或云盘文件内容，仍不能确认当前 inbox-channel/inbox-bridge 是否启用、revision/source 是否可信、当前运行 dataRoot 是否含 owner reservation。旧真实交付也没有验证当前请求→dot→v2 echo 全链路。父会话还需完成：

1. 从受信运行实例的只读 status 确认当前 channel 映射、bridge.enabled、projectRoot；投影状态须 projected/unchanged。not_configured/disabled/blocked 均不足以称请求已交付；blocked 应按 reason 处理。
2. 确认云端同一项目的 requests/incoming/receipts 目录身份、现有授权能读 requests/receipts、能向 incoming 写完整字节；P/requests 首次由应用安全创建，不应手工伪造 owner 或复制旧 manifest 认领。
3. 让父会话安排的实际 dot producer 读到最高完整 v2 generation，按固定 R 创作与返回一次真实 v2 包；读取云端精确 receipt，核对 association 的 requestId/hash/run/item 与封面，再验证原包重传不重复。

没有仓库证据表明存在可供外部调用的 dot API、自动触发监听器、当前云端 producer 或已启用生成日程。当前请求文件不会自行唤醒 dot；纯 inbox-only host 只扫描收件，不运行计划 business tick，因此不能替代当前代码中 `syncPlanDot → exportPlanDotBridge` 的请求投影步骤。

## 8. 核对依据与本次边界

权威字段：`src/shared/plan-dot.ts`、`src/shared/inbox.ts`、`src/shared/dot-delivery.ts`、`src/shared/creation.ts`。实现：`src/core/plan-center-dot.ts`、`src/core/plan-center-integration.ts`、`src/core/inbox/{plan-dot-bridge,controller,service,receiver,dot-delivery-bridge,dot-delivery-store,dot-delivery-receiver,dot-delivery-package,dot-delivery-files,dot-delivery-image,dot-volume-policy}.ts`。

相关已读回归覆盖：`tests/plan-dot.test.mjs`（33个测试，含v2/停止/过期/并发版本分配/不可变投影/owner恢复/发布竞态）、`tests/dot-delivery-bridge.test.mjs`，以及已有 `docs/integrations/dot-{inbox-delivery-contract,local-receiver-checkpoint-20261018,sync-bridge-checkpoint-20261018}.md`。历史通过结果见 `docs/release/provider-wiring-0.10.md`；本文为只读协议审计及文档交付，仅追加第7节固定本机路径属性检查，没有重新执行业务测试、云盘文件内容读写、通信、GUI、原数据库或凭据访问。

本文校验：6 个 JSON 代码块均可解析；离线 R 的 requestHash 重算匹配，text 的 requestEcho 与 R 完全相同；R 与完整 v2 text 分别通过当前仓库 PlanDotRequestSchema/InboxPackageSchema；`git diff --check` 通过。说明占位符所在 projection/manifest/READY/receipt 代码块用于解释结构，不能直接投递。
