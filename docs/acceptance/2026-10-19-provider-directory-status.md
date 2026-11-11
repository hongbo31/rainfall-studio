# 0.12.0-preview.1 提供商与目录任务状态

本分支独立于已发布的 0.11.2-preview.2（GitHub f7c4a8d）。未替换正式交付指针，也未上传本分支。

## 已实现

- 豆包与 DeepSeek 独立文本配置：固定官方 HTTPS 域名、模型/接入点、版本化价格及币种；Key 仍经 Main 独立保险库取得，前端不接触密钥。
- provider 计划按持久 claim 执行生成、模型评分、有限改写，保存稿件/提示词同一最终版本和费用证据。每次计划的额度由歌曲共享。缺 Key、价格或授权会显示待配置；结果未知不自动重发。
- 目录任务是独立输入渠道。原生选择器授权路径，绑定已保存的计划/修订，默认暂停；严格请求只含逻辑 ID、修订和计划引用。支持稳定双观测与 request.json + READY.json，持久幂等、队列、停止和重启恢复。只读输入目录，不把目录内容当任意命令或授权。
- 配置中心集中模型 API、目录与素材收件，提供首次准备状态。作品、封面工作室和发布材料沿用已有链路。

## 独立审查后修复

1. DNS 等待期间停止：HTTP 实际发送前再次异步核对持久 dispatch grant，保留已领取操作的未知状态，不发送新 POST。
2. 超过 100 个文件：每轮最多 100 项，持久排序游标轮转，101 文件最终全数读取；不再永远停在前 100 项。
3. provider 文本单阶段公开重试：明确禁用并提示先停止、核对额度后重新执行，避免创建永远 dispatching 的第二阶段；评分内部有界重试策略仍受原授权限制。
4. 空作品库封面工作室：不再以空 workId 请求 cover.list，直接显示先建立作品。该问题仍属于冻结 0.11.2 的已知限制。

## 最新验证

- npm test：3/3。
- typecheck 与 desktop:build：通过；构建保留现有大 chunk 提示。
- provider-text：15/15；provider-plan bridge：10/10；directory：9/9。
- 原 plan-center / production-flow / unified-plan / cover-recovery：105/105。
- 三项审查复现先 RED 后 GREEN：停止期间 HTTP 发送 0；101 项目录接受数 0→99→101；失败文本重试拒绝，新增阶段/外部操作 0。
- 实际构建 React + 隔离 SQLite Core + Main broker 联合体验通过。先新增空作品封面回归并复现 RED，修复后完整流程 GREEN。包含配置、计划、目录稳定扫描/去重、fixture 生成与评分、等待封面、作品与发布页、暂停。fixture transport 2 次，真实网络 0，凭据写入 false。
- 证据：output/provider-directory-regressions/probe-results.log；output/provider-directory-acceptance/latest.json；output/provider-plan-bridge-tests/regressions-ea624311-099e-4567-baaa-9a097699f8ec/test.log。

## 边界与启动

此版本真实原生目录选择器点击、豆包真实推理/计费、平台上传/发布和统计均未验收。联合界面截图来自 HeadlessChrome，不是原生桌面截图；0.11.2 安装版原生验收不转记为本版通过。首次设置中的授权为测试夹具隔离范围，不代表真实账户已可用。

开发构建：npm run desktop:build。独立候选：node scripts/package-provider-directory-candidate.mjs；保持整个目录，手动启动 RainfallStudioCandidate.exe。默认使用候选目录下的 candidate-data；不要复制原账号库或改正式桌面指针。测试用 node scripts/test-provider-directory-regressions.mjs、node scripts/test-directory-tasks.mjs、node tests/provider-text-run.mjs、node tests/provider-plan-bridge.test.mjs、node scripts/test-provider-directory-ui.mjs。
