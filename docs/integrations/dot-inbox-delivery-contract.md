# dot 自动投递合同 v1（源码已实现，实际链路待验收）

Windows 批次名规则：batchId 身份忽略 ASCII 大小写；首次成功包保留原始拼写。同一通道的 `Batch` 与 `batch` 视为同一批次，第二个不同原包将冲突拒绝，不能创建覆盖同名回执的另一批次。请父端始终复用首次 batchId 原拼写；建议统一小写。

更新：本地收件产品源码已实现，尚未打新包或实际验收；旧版 0.4 不包含本次改动。仅使用隔离假数据执行开发单元测试，不能称 dot 自动交付已打通。下面协议适用于本次新源码。

最终目录由现有 Main 数据根固定派生为 `<root>/<mode>/inbox-v1`，在软件的自动收件箱设置中显示真实绝对路径。生产默认 `<%APPDATA%>/RainfallStudio/production/inbox-v1`；预览/自定义数据根各自独立。以客户端返回路径为准，不照抄下文最初拟定的 LOCALAPPDATA 路径。首次配置之前不会创建收件目录；本轮未配置实际通道。

错误包目前在 rejected 写 `<文件SHA256>.error.json` 和隔离原包；schema 错误回执仅含固定错误码，不回显不可信内容或条目详情。非法 UTF-8、未知字段、错工作区/映射、冲突会隔离；超大/硬链接/叶子链接目录项按随机接收 ID 隔离且不读取内容或目标。祖先目录链接仍拒绝整个扫描。一次最多处理 100 个完整文件，运行中约 5 秒扫描，启动补扫。需要更详细条目索引时可在后续诊断增强，不影响幂等或成功回执。

信任粒度为用户配置的同账户本地通道，不是经过签名认证的 dot；本轮没有创建 Windows ACL、账号或新凭据。最小权限应由父端已有授权连接约束，无法将同用户其他进程排除为潜在文件作者。

目标电脑 目标 Windows 设备 的连接/授权由父会话已确认；未来定时执行、原包持久保留、回执读取及离线重试仍由父端落实，本合同不是已部署日程。不能向旧版 0.4 投递后报告成功。

## 通道

父端使用已经授权的本机文件写入能力，只写双方固定映射的收件目录，不运行 JSON 内容。使用新客户端通道设置返回的绝对路径；当前未创建真实目录或变更 ACL。

根下 incoming 为父端可写，receipts 为父端只读；Core 单独管理 processed/rejected。不能把父任务的任意工作区权限等同于收件目录隔离，实施时须确认最小权限边界。JSON 的 producer/model 是声明；可信上下文来自本地通道映射，不能由包设置。相同 Windows 用户其他进程可能写入同目录，界面不宣称已验证 dot 身份。

## JSON 包

UTF-8、严格 JSON；最多 1 MiB、20 条。ID 为 ASCII `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`，不得从标题/歌词构造路径；externalItemId 同样约束。batchId 对应 `<batchId>.json`，写入时使用唯一 `.partial` 临时文件，完成后原子改名。重试复用原包，不改变 batchId、时间或条目版本。

```json
{
  "schemaVersion": 1,
  "batchId": "rain-20261015-b1",
  "createdAt": "2026-10-15T09:00:00+08:00",
  "targetWorkspaceRef": "rainfall-personal",
  "items": [
    {
      "externalItemId": "rain-series-001",
      "revision": 1,
      "parentRevision": null,
      "artistRef": "creator",
      "seriesRef": null,
      "draft": { "此处仅说明": "实际必须完整符合 CreativeDraftSchema，不能照抄此占位对象" },
      "provenance": {
        "producer": "dot",
        "model": null,
        "promptVersion": null,
        "generatedAt": "2026-10-15T09:00:00+08:00"
      }
    }
  ]
}
```

以上是 envelope 示意，不是可导入样本。正文合同以 `src/shared/creation.ts` CreativeDraftSchema 为准：title/topic/storyBeat/language/style/instrumental、sections、hook、vocalPlan、musicPrompts.suno/yourmusic 和 continuityNotes 全部完整；纯音乐按已有 schema 处理。现有 `tests/fixtures/workflow.cjs` 的 draft() 可供隔离测试，不能当真实每日生成结果。

artistRef/seriesRef 仅在本地通道预设别名中解析，拒绝未知或跨艺人归属。revision 正整数；parentRevision 为 null 或小于 revision 的正整数；同包不得重复 item identity。未知字段（包括执行命令、路径、下载 URL、秘密）拒绝；不从包跟随 URL，也不调用模型修补错误包。

hash 由客户端递归排序对象键后编码 UTF-8 计算 SHA-256，数组顺序保持；不 trim/改写文本值。忽略 JSON 空白与键顺序差异。条目去重使用 channelId+externalItemId+revision 的完整条目 hash，batchId 对应完整规范化包 hash。哈希不是身份签名。

## 回执

`receipts/<batchId>.json` 只在事务提交后导出：

```json
{
  "receiptVersion": 1,
  "batchId": "rain-20261015-b1",
  "packageHash": "<客户端重算的64位十六进制SHA256>",
  "workspaceId": "<本地实际工作区ID>",
  "importedAt": "<UTC ISO时间>",
  "status": "imported",
  "items": [
    {
      "externalItemId": "rain-series-001",
      "revision": 1,
      "draftId": "<本地UUID>",
      "candidateId": "<本地UUID>",
      "status": "imported",
      "evaluationState": "model_pending"
    }
  ]
}
```

重送的已有条目返回同 ID，条目 status 可为 existing；不产生第二次评分/生成。包内错误整包拒绝，错误回执 status=rejected，带固定错误码及条目索引，不回显密钥/完整歌词。ID 被篡改、路径非法或无法安全归属的坏文件进入 rejected，不能为了导出错误回执采用不安全文件名。同 batchId 不同 body 的冲突不能覆盖已有成功回执；单独 quarantine/冲突记录按接收文件摘要寻址。父端必须同时匹配 batchId、packageHash、workspaceId，不能只查文件存在。

## 父端与客户端状态

| 条件 | 父端应报告 | 客户端行为 |
|---|---|---|
| 已生成但本机不可达 | 待交付，保留原包 | 不宣称收到 |
| 文件已写入、客户端退出 | 已投递，待入库 | 下次正常启动自动扫描 |
| 文件完整且事务提交 | 仅匹配成功回执后报告已入库 | 文本候选可见，本地检查，模型待评分 |
| 内容/schema/身份冲突 | 拒绝/需修正 | 隔离，不覆盖既有记录 |
| 回执超时/丢失 | 待确认，补交同包 | 幂等返回已有 ID、重建回执 |

父端将生成结果与 manifest 保留至明确成功回执；客户端不得删除父端云文件。离线后如何自动唤醒补交取决于父会话实际可用的调度/连接能力：重连触发尚未核实，可在后续已授权任务中重试，但当前不能创建任何任务。时间/时区/组数仍未决定。

## 本轮交付及验证状态

当前源码实现、28 个新开发用例 + 13 个配置/凭据单元回归通过（41/41），静态 typecheck 通过；没有新包。用户验收、实际投递/补交、真实服务和调度仍未运行。旧 117/117 不能为此次链路背书。
