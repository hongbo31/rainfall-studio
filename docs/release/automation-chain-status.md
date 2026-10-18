# 自动创作到发布链路 · 只读盘点

2026-10-16 10:01 UTC。结论：**完整链路没有打通，也没有每日自动运行的生产证据**。本轮没有启用计划、读取密钥、调用生成、接受新协议或上传新歌。

## 实际配置证据

依据桌面快捷方式定位 `RainfallStudioLauncher/current.json`，其当前指针为 `0.5.0-preview.2-229097c93bd7`。只读打开该指针对应的生产 `library.sqlite`，没有创建 Studio/迁移/恢复实例。

结果：`dailyPlans/plans/occurrences/creativeTurns/drafts/evaluations/operations/candidates/works/batches/units/inboxBatches/textCandidates` 均为 0；API profile 为空，收件通道未配置，选定音频作品数 0。数据库文件大小及修改时间检查前后相同，凭据未读取。证据为忽略目录中的 `output/chain-audit-readonly.json`。

这只说明桌面启动器**当前指针**的生产库，不推断其他隔离库、浏览器账户或外部账户不存在配置。本分支没有部署至该日用入口。

## 逐段状态

| 环节 | 已实现 / 离线证据 | 实际接通状态与缺口 |
|---|---|---|
| 每日提示词/歌词候选 | 有时区、日程幂等、预算和重启逻辑及 fixture 测试 | `DailyScheduler.enable()` 抛 `DAILY_EXECUTION_DISABLED`；桌面工厂 `allowFixtureExecution:false`，生产 dispatch 禁止；实际计划/发生记录 0。旧本地模板计划另算，不等于 AI 候选 |
| 文本生成、评分与打回 | 有版本化歌词/音乐提示词、规则、评分、复核、修订上限和人工处理 | 生产文本 registry 未注册真实适配器，真实生成/自动模型评分未开启；策略未批准进入 shadow，成本/结果未知保持 pending，达到修订上限或重大分歧转人工。不能把规则/fixture 分数当真实模型或音频审听结果 |
| 音乐生成 | 有 `YourMusicAdapter` 的请求/查询/下载契约，MusicService 幂等与未知结果保护 | 生产 credential/request 均抛 `LIVE_EXECUTION_DISABLED`；生产 prepare 也阻断。当前配置/任务/候选均 0，没有真实生成验收 |
| 音频和歌词入库 | 下载验证、资产哈希、候选选择、歌词来源版本、A 音频关联已实现并有离线测试 | `candidate.select` 明确选择后创建作品并关联 `audio_A`；优先保留 provider 实际歌词，否则标明生成输入来源，不把音乐提示词当歌词、不捏造音频对齐。当前生产库无候选/作品；官网外部提交不证明这条入库链已执行 |
| 发布衔接 | 作品库多选、材料预检、账号备注、批次与 claim 持久化、独立授权/提交许可已实现 | 选候选不会自动开始发布。腾讯真实只读链路已读到现有歌曲审核中；当前原生写入因唯一账号/当前作品身份未核验而三层阻断。其他发布平台仍是材料准备/人工路径，统计仍为报表导入 |

修复前 Core 145/145 证明离线组件；此次上传收尾的针对性 29/29、受影响回归 50/50 也不是整条生产流水线验收。

## Suno 与谱乐：供应商和文档

父会话本次公开核对：[Suno API 官方入口](https://platform.suno.com/) 明确宣传 REST 音乐 API，但跳至登录；尚未核验用户可用的 endpoint、价格和账号权限。因此不能再说 Suno 没有 API，也不能把 Suno 订阅当 API 权限。本地仅有 provider 目录项，未实现 Suno 专属 HTTP 适配器，也没有可绑定的 Suno 安全配置；`credentialInput:false`，不会调用目录域名猜接口。

用户指定的“普乐/谱乐”按 `app.yourmusic.fun` 处理，是独立供应商，不能标为 Suno 官方。父会话核对的 [谱乐公开 API](https://api.yourmusic.fun/) 与 [文档入口](https://api.yourmusic.fun/docs) 对应本地保留的 `docs/integrations/yourmusic-openapi-2026-10-15.json`（OpenAPI 3.0.0，谱乐 AI · Open API 1.0.0，server `https://api.yourmusic.fun`）：

- 文档有 `POST /v1/suno/generate/prompt` 和 `POST /v1/suno/generate/custom`；现有适配器使用 custom。
- 202 回读 `task_id`、`songs[].id`；查询用 `GET /v1/music/generations/query?songid=...`，不与旧 `/api/openapi` 路线混用。
- 已实现白名单下载、音频验证、provider 歌词保存与候选入库关联，但生产 transport 未注册，尚无实账户结果。
- 未核实音乐单次扣费、余额、失败扣费/退款和严格单首选项。代码中的 `maxCost:2` / `fixture_credit` 不是实际价格依据。
- adapter 标记 `maximumOutputs:2`。后续精确核查保留的 `OpenApiSubmitResponseDto.properties.songs.description`，明确写明这些生成提交 exactly two songs，custom 请求无单首数量字段；MusicService 的现行容量也按至少 2 个输出处理。现有合同无法保证仅生成 1 首，需父会话与用户决定，不能把“一次请求”偷偷等同“只生成 1 首”。

当前指针库不存在谱乐 API profile，故没有可绑定的安全配置证据；密钥存在于其他环境与否、有效性及余额均未知，未读取凭据文件，未使用聊天里的旧密钥，未新增持久凭据。

## 下一次实际生成测试的最小条件

用户已将数量限定为每次 **1 首调试**；这不是无限重试或持续批量授权。先确定实际供应商和可用文档：能取得用户有权使用的 Suno 生成合同则按该合同；否则按用户指定的谱乐适配器继续。必须先确认单次价格与费用上限、能否严格只产出 1 首；若平台固定产出 2 首，先报告并由用户决定，不能自行增加数量。

需要正确工作区的已有安全配置状态（只报存在/有效性，不显示密钥），以及一份用户认可的歌词/提示词和模型。当前没有可用安全绑定时，应由父会话协调正规安全配置方式，不从聊天复制密钥、不擅自新建凭据。

在正式请求前持久化本次 request/operation；如已有远端 task/song ID，先查旧任务状态。网络超时或扣费未知时进入待核对，不重新 POST。生成结束仅下载、验证并保存一份可追溯音频/实际歌词，再由用户明确选择入库；不连带授权发布。每日调度和全平台无人值守仍需后续独立验收。

本轮后续的正常浏览器身份核查、旧版/候选设置差异及候选位置见 [最小联调准备补充](tme-readiness-followup.md)。
