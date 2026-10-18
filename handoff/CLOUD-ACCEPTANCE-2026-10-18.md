# 云端验收复核 · 2026-10-18

## 结论

本轮允许使用 dot 云端可见 UI。当前源码和上次候选归档均存在，未操作原 Windows 主机，未上传、重提审《把晚安留在门口》，未收费生成、接受协议或修改账号。

当前可验收的是本地材料逻辑、封面/弹窗离线策略及腾讯官网只读状态，不能认定 Rainfall Studio 自动上传、弹窗处理和提审端到端已经打通。未改生产代码或启用未校准契约。

## 本轮新执行结果

- node scripts/test-tme-cover-cloud.mjs：149 / 149 通过。
- npm run typecheck：通过。
- npm run desktop:build：通过，既有 bundle-size 警告。
- git diff --check：通过。
- npm run test:publish-materials：材料核心 28 / 28 通过；后续浏览器交互 10 项均在 before hook 阻断（测试硬编码 C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe，Linux 上不存在），业务交互断言未执行。整体命令退出 1，不称全量通过。

原始日志：cloud-validation/acceptance-targeted.log、acceptance-typecheck.log、acceptance-build.log、acceptance-materials.log。

## 腾讯官网只读观察

2026-10-18 06:23–06:25 UTC，dot 云端 Chromium 现有会话显示艺名“栩你听海”。

1. 原创上传入口 https://y.tencentmusic.com/#/user/manage/add 显示选择文件、原创专辑选择、“下一步”禁用；没有已选音频，也没有阻塞弹窗。本轮未选择文件、创建专辑或进入下一步。
2. 导航到原创作品，未发布歌曲栏显示“暂无歌曲”。
3. 已发布 → 歌曲栏 https://y.tencentmusic.com/#/user/manage/albumlist?tab=published&type=Song 显示《把晚安留在门口》单曲、AI音乐、未签约，发布时间原文为 2026-10-18 12:32，未推定网站时区。上架状态是无文字图标，本轮未验证各平台播放。
4. 歌曲行的所属专辑链接带有 6444842，本报告不把它当作单曲 ID。未打开编辑、删除、推广、签约或设置。

## 接线复核

- src/renderer/pages/PublishCenter.tsx：生产“发布”按钮调用 publish.simple；成功提示“已整理发布材料”。该按钮自身不是官方上传提交。
- src/renderer/components/PublicationMaterialResult.tsx：结果呈现素材快照、补音频/补歌词/补封面等操作，并显示“暂不能提交”原因。
- src/main/tme/page-contract.ts：生产默认 verified:false，账号、草稿和上传 selectors 尚为空。
- src/main/tme/browser-port.ts：observe 先拒绝未校准契约，之后才可能进入 TmePageOverlayGuard。生产 manager 使用默认契约，因此新弹窗 guard 当前不会在此生产路径运行。
- page-overlays.ts 的四条规则只允许已观察首页完整 URL，不能扩张到原创/AI 上传页。
- src/main/tme/ai-prepare.ts：原生端口仍有 Windows 平台检查及 pwsh.exe/UIA 依赖，未接入 DOM guard。Linux 不具备等价 Windows UIA 执行链。

## 仍欠缺的验收

1. Rainfall Electron 客户端可见窗口及真实按钮交互：当前源码依赖目录中 Electron 可执行文件未安装；本轮没有启动原生窗口。构建/SSR/核心测试不替代此验收。
2. 当前弹窗代码真实 DOM 选择器、实际关闭以及上传页面契约校准：现有页面无相应弹层，历史首页规则不能证明上传链可用；不能仅把 verified 改成 true。
3. Windows UIA/PowerShell 裁剪、选择器、前台归属及读回：须另有经用户许可的 Windows 隔离环境；不自动回原电脑。
4. 若验证真实上传以后字段、保存、条款和提审回执，需要单独批准的新测试作品/素材与相应步骤。已手动提交作品不得复用或重传；用户允许验收不等同批准新上传、协议接受或提审。

因此本轮不覆盖原桌面入口，不将候选标记正式验收通过，不生成新正式发布回执。

## 判定与调用链

验收判定：不通过。问题是完整发布功能尚未实现，并非仅缺弹窗 guard。

1. 单一发布入口 → Renderer call('publish.simple') → Studio → publishSimple → 本地素材检查、快照、settings 保存。此链没有调用上传准备调度。
2. 另一个发布诊断界面 → TmeAiPrepareWorkspace → preload → rainfall:tme-ai-prepare IPC → prepare broker → Windows 原生适配器 → 定位、上传A、元数据、封面、专辑材料快照、条款预览。此链依赖逐作品本地授权文件；不是发布入口的自动后续动作。
3. 提交前检查 → tmeAiSubmission broker。bootstrap 未注入 executor，accept、submit、readReceipt 没有可用生产执行器，能力状态始终拒绝。
4. productionFlow 的 publication 同样使用显式 blocked port，不是隐藏的可用备用链路。
5. 准备 UI 还含去敏后的固定作品 ID，inspect 调用没有传当前 workId，多授权场景下不能视作通用选歌发布流程。

## 可执行补齐方案（本轮未实施）

保留“选歌、选平台、点发布”的单一入口：

1. 让单一入口创建或复用持久发布任务，绑定作品/音频A/平台/账号/素材哈希，并按顺序展示“准备材料、待确认、正在提交、官方回执、需只读核对”状态。已经完成或结果未知的任务不得重新调度上传。
2. Main 端统一编排既有 prepare 与 submission 状态机，补充逐首授权查询/登记与准确 workId 传递。已有具体授权只驱动所覆盖动作；缺授权、费用或新协议时进入对应确认流程。不得复用已手动发布旧歌的授权，也不能把材料检查点击视为无界投稿授权。
3. 实现真正的受限生产 executor：精确页面/账号/作品绑定、素材检查、条款哈希确认、单次接受/提交和官方单曲回执读取。保留默认未校准阻断；真实校准前不提供可用能力。
4. 将弹层策略接到实际使用的执行通道，只有经校准的安全提示能关闭；登录、验证码、协议、未知阻塞继续暂停。首页规则不能直接授权上传页关闭。
5. 补齐恢复和幂等：持久 intent、CAS revision、操作 ID、跨重启防重复、在途 busy、未知结果只读 reconcile；官方专辑ID不得充当单曲ID。回执须含账号、单曲身份、平台状态、观察时间及证据来源。
6. 云端先做编排、授权、幂等、恢复和故障注入验证；真实客户端/Windows UIA与新作品上传链须在另行获准的隔离环境及新测试素材上验收。若坚持只用当前 Linux 云电脑，需要另行建设云浏览器执行通道，不能沿用 Windows UIA 冒充已通。

最小下一步：先完成上述纯本地编排与安全状态机实现，不需用户重复上传旧歌。到真实执行验收时，仅需选择“另行许可的 Windows 隔离环境”或“继续建设 Linux 云浏览器执行通道”，并单独授权新测试作品的素材及允许步骤。原 90VC 主机不在本次范围。
