# 实施计划

按照已授权范围直接实施；三个独立接口任务并行，根代理整合 IPC/生命周期后统一验收。已验收 0.11.2-preview.2 不被新候选替换。

1. 文本：扩展 ApiProfile 豆包和固定 baseURL/model/价格设置；新增 shared/core/main provider-text。Core `ProviderTextService(repo,{now?,recover?})` 提供 `prepare(input),list(),context(id),claim({id}),record(input),stop(ownerKey),recover()`。prepare 输入含 ownerKey/runId/itemId/artistId/profileId/profileRevision/modelId/budgetMicros/maxOutputTokens/theme/styleTemplate/threshold/maxRewrites/maxScoreRetries/consent；job 返回持久 id、phase/state、draft、score、版本和操作证据。Main broker `createProviderTextBroker({credentials,rpc,available,generation}).pump()` 通过 internal.providerText RPC 领取并执行固定供应商 adapter。任何会收费的 call 前持久 claim，未知结果不重发。测试真实 schema、离线 transport 与持久状态。
2. 计划桥：provider material source 与 text_generate 阶段；旧 dot 不改。新增可信 job 生成/评分证明的验证、版本绑定、停止；音乐使用单独 startManagedMusicFromVerifiedText 严格读取持久 job，复用音乐预算/未知结果规则。封面等待/工作流和 provider 配置选择；计划不再编辑模型 ID。用 fixture provider 完成歌词→评分→等待封面/音乐授权验证。
3. 目录：shared schema + 独立 controller/store，Main 原生 chooser，Core 扫描/队列/生命周期，严格请求和 READY。新增 directoryTasks.status/save/pause/resume/scanNow/stop 受限 RPC；内部 configureDirectory 仅 Main 可写 root。测试稳定观测/哈希、重启和持久幂等、变更版本、冲突、忙碌、停止、路径与恶意输入。设置中心分开任务目录与素材结果；目录只选已保存计划。
4. 根整合：register schema 白名单，Main broker/selector，Core internal RPC 和 Studio tick/close、中断 epoch。同步新增方法的可信源与工作区 guard；不改变旧正式 dataRoot。
5. 验证：typecheck、build、现有相关回归、新增安全与恢复测试；冻结新版本源码提交、完整便携候选和独立测试 dataRoot。实际 Core/renderer 离线交互截图，必要原生窗口仅在不争用当前 UI 时执行。提供独立评审启动入口、稳定时间和步骤，标明真实与 fixture 边界。无真实 key/收费/发布测试。

重点复核：停止与在途响应、文件重写同 revision、请求企图扩权、供应商计费/币种混淆、可信生成证明被替换。每项均需相应测试，失败修复后才宣称完成。
