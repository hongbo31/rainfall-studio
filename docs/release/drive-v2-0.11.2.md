# 0.11.2-preview.1：实际专辑ID读取与隔离Drive请求

本轮按新授权完成三项有界工作，没有扩大为新的外部执行架构。

- 生产专辑选择采用官方可见组件 selected.id/name 与 albumInfo.id/name 一致校验；真实后台当前未选择，阳性读取仍待现成选择。创建合同不再强求平台提供本地幂等字段；原操作证据不足保留 unknown/manual_review，生产创建和追加门禁继续关闭。
- 在授权 Rainfall 同步父目录下建立独立 acceptance-v2-20261019 项目。先只读核对正式/旧接收器绑定，避开共享收件范围；用独立SQLite保存一条歌词+封面、music=false/autopublish=false请求。云端字节回读及独立进程unchanged已验证；没有修改正式每日计划、账户或原库。
- 新 directory delivery v2 支持仅歌词 images=[]、回执v2省略封面字段。旧v1仍每item一张封面；任何匹配已保存R的包不得夹带未请求封面，移除echo/降级包装也不能绕过。v1保留whole-plan music/cover-only旧兼容，v2严格要求歌词且无音乐输出。

独立审查验证并修复了两个问题：legacy无echo包匹配新R时越过cover范围，以及把whole-plan music标志误当包内audio导致旧计划不能收件。完整回归第一轮实际检出后者，失败报告保存在 output/drive-v2-completion/first-pass-report.json；最终结果以同目录 final-verification/report.json 为准，未隐去失败。

本轮真实操作仅后台平台只读、限定绑定字段只读及隔离Drive请求文件；没有上传歌曲、条款接受、平台创建/发布、音频/图像生成调用或收费。实际请求全文、owner/通道/云端链接和回传命令在 docs/integrations/2026-10-19-drive-v2-real-request-handoff.md；仅歌词兼容规则在 dot-delivery-v2-lyrics-only.md。

当前候选的构建、提交、哈希和验证见同版本交付JSON。正式入口仍保留旧版；不把便携包当作已升级或原生验收。最小窗口清单见 docs/acceptance/2026-10-19-native-minimum-operations.md。当前新增版本没有执行附件重传；上版官方附件transfer_failed事实保持，未换通道。
