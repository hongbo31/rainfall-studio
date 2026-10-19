# TME 稳定身份只读校准（2026-10-19）

当前已获授权的 DESKTOP-90VCPDC Edge 官方会话处于登录状态。本轮已经取得稳定 TME 账号与艺人字段，并完成两次新建后台页读取的一致性检查；此前“缺少稳定 ID 来源”的调查阻塞已解除。本轮没有执行实际绑定、保存新授权、注册生产绑定适配器、付费调用或发布。

## 已核实的字段来源

读取对象是现有会话中 `https://y.tencentmusic.com` 官方 SPA 自行发起的 GET `/v2/v2/user/getUserInfo` 响应，HTTP 200、`code: '0'`、`success: true`。未通过 request/fetch 直接调用接口，亦未把该内部路径声明为公开 API 合同。

| 官方响应字段 | 本地含义与命名空间 | 交叉校验 |
| --- | --- | --- |
| `data.singerInfo.accountId` | `tme-musician` 的 `remoteAccountId`，TME 发行账号 | 页面加载态 `userInfo.singerInfo.accountId` 及 `headInfo.accountInfo.id` |
| `data.singerInfo.id` | `tme-musician` 的 `remoteArtistId`，TME 艺人 | 页面加载态 singer ID、`headInfo.singerInfo.id` |
| `data.singerInfo.name` | 官方艺人显示名 | 顶栏唯一可见艺人名、加载态艺人名完全一致 |
| `platformInfos` 中明确 `platformName: QQ音乐` 的 `platformId` | `qqmusic-singer` 的歌手 ID | `data.platformIds.qyin` |
| `platformInfos` 中明确 `platformName: 酷狗` 的 `platformId` | `kugou-singer` 的歌手 ID | `data.platformIds.kugou` |
| `data.singerInfo.qyinSingerMid` | QQ 音乐歌手 MID 辅助信息 | 仅保留规范的字母数字值 |

这些字段不能称作 QQ 登录 UIN，也不能据此推断 QQ/酷狗登录账号已经绑定。实现没有猜测数字 `platformType` 的平台含义。`accountDisplayName` 是明确带“TME 账号”前缀的本地 ID 标签，并非官方登录昵称。

## 读取实现与保护

独立模块：`src/main/tme/official-stable-identity.ts`。它只复用调用方传入的现有官方 Page/context，通过现有后台页 helper 创建一个临时官方页并等待该页自己的 GET 响应；不点击控制、不启动浏览器、不创建 profile、不保存认证。

创建临时页前，以及读取完成后，都会校验原页面的顶栏、加载态账号/艺人 ID、加载态艺人名和已有 head ID 是否自洽；响应还必须与临时页的同组信息完全一致。缺字段、非正整数或不规范 ID、同名不同 ID、平台交叉 ID 不一致、原页身份漂移均拒绝。finally 只关闭本轮临时页，并确认原 URL 与原标签页集合保持不变。清理错误仍会失败关闭；保留原始错误 cause 是后续诊断改进项。

完整 JSON 响应仅在内存解析；不提取或落盘无关个人字段。身份结果及 evidenceHash 仅包含允许的身份字段。没有复制 Cookie/Token、读取认证 storage、创建凭据或保存新授权。完整身份值仅保存在本机忽略目录的选定字段文件中，不进入源码快照、安装包或对外交付证据。

## 实测与复核

最终只读实测：2026-10-19 10:12:24.959 至 10:12:28.284 UTC。脱敏证据位于 `output/tme-identity-calibration-20261019/live-reader-verification.json`。

- 两次新后台页读取的 TME account/artist、QQ/酷狗 singer ID 一致；原主页面与原标签页集合保留。
- `passed: true`，`primaryPreserved: true`，`stableAcrossTwoFreshBackgroundReads: true`。
- `bindingCreated: false`，`registeredProductionBindingAdapter: false`；实际绑定、发布、付费模型调用、直接 API 请求均为 0。
- 最终 reader 源文件 SHA-256：`6214d3339fe927227cd2ecf8622b3d0d21792b9e0e7264191c76f133e88c553f`。
- `node scripts/test-official-stable-identity.mjs`：10/10，包括原页初始矛盾拒绝、结束时身份漂移拒绝、临时页清理及字段解析；`npm run typecheck` 通过。
- 独立复核重跑 10/10，并用六组漂移探针验证修复。报告：`output/tme-binding-contract-review/stable-reader-review.md`，无剩余 Important。

没有重启用户浏览器，`externalBrowserRestartVerified: false`。证据只支持当前会话的重复读取一致性，不能外推为永久登录、重启后可用、用户已确认账号映射或发布权限已经就绪。

## 版本与下一步边界

本模块尚未由产品入口引用，也未注册为 `AccountIdentityAdapter`。原有 OfficialAccount、复合 hash、去重与 intent 合同保持不变。后续真实绑定应使用这组已核实的命名空间字段，展示具体本地艺人映射并按用户授权执行；当前没有新增读取许可或重新登录的阻塞。

0.12.0-preview.3 便携候选及本轮安全源码快照/安装包冻结于代码 `d423140ce9168830d5f3d3e50dbd42af8f9f1873`（验收文档追加至 `6af7641bdb2533af777d737f75ec240d88f69697`）。它们不包含本次后续校准 reader，不能声称安装包已有可用真实绑定。正式 0.11.2 入口、快捷方式和数据根目录没有切换。

封面能力仍为本地图片与 dot 外部结果导入；尚未连接图像生成 API，也没有可免费直接调用的 Codex 图像 API 接入。
