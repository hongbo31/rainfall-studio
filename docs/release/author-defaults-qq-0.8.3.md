# 署名默认值与 QQ 准备契约补齐

候选版本：0.8.3-preview.2。只做后台工作，桌面已验证版本仍为 0.8.2-preview.1。本轮没有启动或重启原生客户端、抢焦点、生成音乐、付费导出、真实上传、接受条款或正式发布。

## 署名根因与实际修复

用户已明确指定词作者、曲作者均为“云端测试艺人”。检查发现姓名只在旧歌《示例作品A》的 prepare-only 授权和准备记录中；新歌《示例作品B》及 QQ／酷狗平台默认值均为空。账号名称虽含该艺名，但账号名称不会自动成为作者署名。已有材料收集器支持读取作品署名并回退到平台默认值，问题在于先前没有把明确授权的姓名保存到这些记录，而不是用户需要重新填写。

按本次授权先备份实际 SQLite，再在备份副本验证后执行带修订号和原 JSON 比较的原子更新：

- 新歌 `00000000-0000-4000-8000-000000000001` 的 `publicationMetadata.lyricist/composer` 均设为“云端测试艺人”，revision 6 → 7。
- 同一腾讯观察账号对应的 QQ 默认配置 revision 2 → 3，酷狗配置 1 → 2，仅补齐词曲署名。
- 保留修订历史与审计记录。不改本地艺人占位名，不把账号昵称推断成其他资料，不改专辑、不改账号授权。
- 实际只读复核确认原歌曲、所有资产、艺人和账号未变化；其他设置除运行中客户端正常更新的 `production-flow:clock` 时间外未变化。历史检查及旧歌的准备／法律记录保留原样。

回归验证“平台默认署名 → 新作品发布快照”，以及作品单独署名优先于平台默认值、材料变化生成新检查、原快照不改写。实际新歌的只读 Core／页面验收确认两项姓名已带入，“补署名”按钮不再出现，试听匹配及权属仍未确认。

内部备份路径和变更范围见 `output/author-defaults-qq/author-repair-result.json`；未将备份或账号数据上传到 Library。

## QQ 上传适配器的具体问题

| 层 | 发现 | 本轮结果 |
| --- | --- | --- |
| 普通“发布”按钮 | `publish.simple` 只做本地材料检查，未调用原生文件上传端口 | 维持明确的“QQ音乐上传未接通”；不伪装发布成功 |
| 原生上传入口 | 09:43 的失败为 `CONTROL_NOT_UNIQUE`；旧代码找 Text“点击此处上传”，留存页面实际为 Button“选择文件: 未选择任何文件” | 增加精确、启用且可见的当前按钮定位；保留精确旧入口，重复／缺失仍阻断。离线执行真实 PowerShell 纯函数测试通过；未运行 UIA 入口或点击官网 |
| 音频回读 | Main 与 PowerShell 把旧歌 03:30 固定写死，新歌官方 WAV 为 174.813514739 秒 | 从校验过的 PCM RIFF 字节读取时长，传递 02:55 预期；旧 03:30 及新 02:55 Broker 测试均通过。官网实际显示的取整方式仍待前台验收 |
| 新歌准备作用域 | 当前正式 Broker 只有旧歌的 prepare-only 本地文件／grant；新歌没有完成准备任务 | 未复制旧授权到新歌，未制造已上传证据；后续需绑定当前新歌 A、身份和窗口，完成实测准备链 |
| 表单 | 自定义日期／语言／曲风／作者芯片等仍只在匹配时继续，不会猜填未知控件 | 当前新歌尚无官网表单回读，可能继续被 `CUSTOM_CHOICE_EDIT_CONTRACT_REQUIRED` 等阻断，待可见验收 |
| 正式提交与回执 | `bootstrap.ts` 明确未给 `createTmeAiSubmissionBroker` 安装正式接受、提交、官方回执读取 executor | 仍不可用：`NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED`、`OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED`；本次没有解除闸门 |

新歌当前只读预检原因精确为 `LYRICS_ALIGNMENT_REQUIRED`、`RIGHTS_UNCONFIRMED`、`PREPARATION_REQUIRED`。音频、歌词和封面存在，AI 来源为 generated。完整试听、权属核实、新歌当前条款与具体法律授权不能由本轮后台工作替用户确认。1254×1254 原封面按实际尺寸保留；尚未证明新歌官网上传／封面适配成功。

## 验证与候选交付

- 修复前：新歌作者断言为空而失败；非 03:30 Broker 测试进入 reconcile_required；当前上传入口测试失败。相关 RED 日志已保留。
- 修复后：完整 Core 202/202，材料针对性 Core 28/28，页面交互 10/10，准备 Core 29/29，原生边界 Broker 17/17，纯控件解析 2/2，安全提交 16/16，原 UI 42/42，默认测试 3/3；类型检查及桌面构建通过。既有大 chunk 提示不阻塞构建。
- 新鲜独立审查无 Critical／Important 问题，另独立验证 PCM 边界 8/8。建议后续把这些边界用例保留为永久测试；本次未扩大该项。
- 证据目录 `output/author-defaults-qq/`：`independent-review.md`、`author-repair-result.json`、`actual-new-song-verification.json`、各回归日志、`candidate-delivery.json`。
- 可移交 Windows 便携候选由已安装 Electron runtime 离线打包，未安装软件、未推送 Git。候选路径和源提交见 `candidate-delivery.json`；默认空 candidate-data 不能替代原作品库。
- 最新截图从候选包真实 renderer 文件在 Headless Chrome 渲染，桥接到真实只读资料和内存 Core 检查；它不是原生窗口或真实上传验收。页面初次挂载的总览字段仅作隔离夹具，不作为预算／统计验收。
- 当前生产库仅发生上述获准的署名元数据更新；截图／预检验证本身生产写入为 0。桌面快捷方式及 verified-desktop.json 保持原样。待用户允许前台验收后，按 `desktop-delivery-policy.md` 验证并更新同一入口。

复验命令：`npm run test:publish-materials`、`npm run test:qq-preparation`、`node scripts/test-tme-ai-prepare.mjs`、`node scripts/test-tme-ai-submission.mjs`、`node scripts/test-headless.mjs`、`npm run typecheck`、`npm run desktop:build`。真实新作检查支持 `--expect-author 云端测试艺人` 与 `--ui-root <候选/resources/app/build/ui>`，所有准备写入仅进入内存。
