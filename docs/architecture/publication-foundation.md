# 发布基础能力：腾讯与番茄

状态：公共机制已由两端代码复用并通过离线契约测试；番茄真实上传及合同流程尚未验证。本文不能作为端到端发布验收结论。

## 实际调用关系

公共模块为 `src/core/publication-foundation.ts`，没有平台页面定位、艺人角色选择、专辑或合同代码。

| 机制 | 腾讯实际调用 | 番茄实际调用 |
|---|---|---|
| 文件字节与哈希验证 | `tme-ai-prepare-integration.ts` 的派生 PCM 校验 | `fanqie.ts` 的全部素材校验 |
| 录音幂等键 | `TmeAiPrepareService.registerGrant` | `FanqiePreparationService.prepare` |
| 检查点版本递增 | `TmeAiPrepareService.patch` | `FanqiePreparationService.put` |
| 中断状态归一化 | 腾讯 dispatching 恢复及 claim 门禁 | 番茄 uploading 恢复及 upload 门禁 |
| 上传回执匹配 | `TmeCoordinator` 上传后验证 | 番茄每个素材上传后验证 |
| 有界只读恢复 | `TmeCoordinator` observe，当前未注入重新认领，保持旧行为 | 番茄 observe 注入受支持的重新认领策略 |
| 去敏检查点日志 | 腾讯 patch | 番茄 put |

腾讯录音键保留历史 `hash([subjectHash,audioSha])`，不迁移已有授权或去重记录。番茄键保持 `hash(['fanqie',account,artist,audioSha])`。两个平台的持久化命名空间、授权及执行器仍分别管理；共同工具不决定应该调用哪个平台。

## 平台策略边界

`publicationPhase` 接收平台状态映射。腾讯的 `awaiting_terms_review` 与番茄的 `contract_pending` 都归为合同待确认，均不是提交或上线。未知状态归为 unknown，不能默认为 ready。

文件工具只验证已有字节与声明是否一致，可注入最大大小、符号链接规则及错误码。腾讯保留自己的完整 PCM chunk 校验、派生来源与专辑封面策略；番茄保留 44.1kHz、16bit、双声道、大于 30 秒、封面至少 1440 方形及 TXT 要求。不能把两套限制合并成一份宽松限制。

共同回执工具只检查上传远端标识和预期哈希的一致性，不制造远端哈希，也不将本地上传记录升级为审核/上线。两个平台的正式记录、专辑与歌曲关联以及签约证据仍由各自策略核验。

## 恢复不变量

1. 先持久化操作/检查点，再调用外部写。持久化失败则不写。
2. 写超时只表示结果未知。不能通过重置状态、重开标签或更改元数据绕过去重。
3. `readPublicationAfterRecovery` 只包围读取。策略可重新认领同一已有页面，再读一次；不接收上传、保存或签约动作。
4. 每个调用方在读回后重新校验平台、账号、艺人、会话、素材及角色范围。辅助函数不能替代平台范围检查。
5. 接受上传回显后，下一次写仍需核对已确认的旧回显，防止材料在中途被替换。
6. 草稿、合同待确认、已提交、审核和上线均独立。离线夹具保留来源标记，不能转为生产证据。

`publication.checkpoint` 统一日志仅记录平台、操作 ID、状态、版本及受限错误码。不记录歌词、账号显示名、文件路径、合同原文或浏览器原始错误。

## 回归入口

- `npm run test:fanqie`：番茄 27 项，加公共契约 13 项。两套策略分别覆盖 stale revision、写中断、回执不匹配、只读恢复、文件变化和日志去敏。
- `node scripts/test-tme-ai-prepare.mjs`：腾讯主准备服务及实际素材验证回归。
- `npm run test:tme`：腾讯浏览器协调器、界面及旧草稿服务回归，使用离线端口，不连接真实浏览器。
- `npm run test:integration`：宿主全套 223 项。

腾讯原有符号前缀封面提示测试的原断言保留。应用户要求，已修复 U+2139 信息图标的精确分类例外并增加反例，完整原生回归通过；未放宽到任意字母或用户输入文本。没有重构 UIA 定位、合同或专辑逻辑。
