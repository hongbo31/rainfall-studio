# 90VC 统一发布候选验收 · 2026-10-18

结论：最新云补丁已经在 DESKTOP-90VCPDC 完成 Windows 构建、真实浏览器本地夹具、隔离便携客户端的界面与恢复验收。**没有完成腾讯实站上传/条款/正式提交验收；不能升级为已接通自动发布版本。** 日用入口未替换。

## 候选与来源

- 独立源码：`C:\Users\31559\Documents\Codex\2026-10-15\task\rainfall-studio-unified-acceptance-20261018`
- 候选源提交：`9d4aeb429727dd8daff839f76619033ce22a4ac4`
- package 版本仍为上游的 `0.8.3-preview.2`，请用源提交区分新旧包。
- Windows 便携 EXE：`out\simple-publishing-9d4aeb429727-1792327940878\RainfallStudioCandidate.exe`（须保留整个包目录）。
- 最终验收数据：`output\native-acceptance\fixture-data-1792327958971`，全新夹具，无正式库/登录态/凭据副本。
- 原去敏 ZIP → d2f1 累计补丁 → diagnostics v1，均先检查再应用。未叠加 ff253 累计源码。原生 ec39d740 与云基线 e3de997 为交接来源映射，本仓库导入基线为 ff861d6。

## 实测

| 项目 | 结果与边界 |
| --- | --- |
| Node24 / Windows typecheck、desktop build | 通过；仍有既有的 bundle 大于 500KB 警告 |
| 基础测试 | 3/3 |
| Studio/SQLite 集成 | 204/204；Windows pipe lease 真实通过 |
| 发布回归分组 | intents 12/12、scope 11/11、prepare core 30/30、broker 22/22、submission 17/17、materials 30/30、target-materials 4/4、browser/UI contracts 69/69、cover regression 151/151；组间有重复，不能相加为独立用例总数 |
| 诊断、SSR 与实际 Chromium 本地 UI | 14/14；其中 Chromium 实际 UI 1 项，不是实站回放 |
| 实际 Chromium DOM 弹层 | 5 条路径通过：准确首页通知仅关闭一次；未知、条款、登录、验证码弹层保持阻断且零点击。页面全部本地提供，非腾讯实站校准 |
| 最终便携 Windows 原生界面 | 8 项通过，2 次可见窗口启动；WinSta0/Default、Session 1、PS7；正常退出，零对应崩溃事件、零生命周期失败、零 renderer 异常/外部 HTTP 请求、零 native 输入进程 |

原生主流程实际点击验证：空选择禁用；双击发布仅一次 publish.simple；缺素材落库；完整材料经 Renderer→IPC→Core 持久任务→Main 调度停在待授权；本地投稿资料保存；未连接 CDP 时失败关闭；两个已发布标题阻断；仅在关闭的夹具库注入中断状态后重启，恢复为待核对结果，重复点击保留相同 ID 且不重传，资料仍在。中断注入是夹具，不是一次真实上传中断。

## 修复与独立复查

1. Windows 不允许普通测试进程创建文件符号链接。改用 Windows 目录联接验证真实路径/祖先防护，Linux 保留符号链接夹具；没有改系统权限或跳过测试。
2. 补齐《留一盏灯》在统一入口、素材解析和投稿资料保存层的保护；新增回归先失败后通过。《把晚安留在门口》继续受保护。测试只用了这两个标题的本地假作品，没有读取/重传正式歌曲。
3. 一名全新上下文审查者发现 QQ/酷狗合并任务丢失第二目标范围的重要问题。现持久保存各目标指纹、派发前逐目标复核，生效资料冲突时暂停并给出配置提示；4 项实际 Studio/SQLite 回归通过。无剩余已知 Critical/Important 审查项。

## 未通过或未执行的边界

- 现有 Edge 只读进程检查：未启用 remote-debugging-port 或 pipe；没有擅自开启或重新配置。客户端连接尝试失败，界面显示 REQUEST_REJECTED；诊断状态明确保留浏览器会话、账号身份、准备、提交、官方回执契约未校准。连接错误文案仍较通用，后续可改善。
- 没有对真实账号页面完成应用内连接/身份核验；没有把浏览器已登录等同于客户端已连接。
- 上游默认 browser contracts 的 verified=false 保持。Windows 原生准备能力仍受具体作品、材料、身份与单独同意约束，正式提交能力默认关闭。
- 没有新上传或未发布歌曲的完整素材及授权。本次范围不允许上传，因此没有测试真实音频/封面上传、裁剪、官网填表、协议接受或正式提交，也没有官方单曲回执。两首已发布作品绝不用于补做这些步骤。
- 实站下一阶段需全新的从未上传作品与完整素材、明确单曲/账号准备授权、获准且已有的连接环境及真实步骤校准证据；协议/正式提交仍须另行具体确认。本次不发起这些动作。

## 文件与复验

- 最终原生报告：`output\playwright\native-unified-1792327959600\report.json`
- 截图：同目录的 `01-missing-materials.png`、`02-metadata-pending.png`、`03-browser-connection-blocked.png`、`04-protected-published-title.png`、`05-restart-recovery.png`。这是实际 Electron 窗口内容截图，没有冒称 OS 全桌面截图。
- 最终构建/回归日志：`output\native-acceptance\final-logs\summary.json` 及各组 `.log`。
- 正式保护核对：`output\native-acceptance\protection-comparison.json`：37 张表、7 个素材、安装指针、桌面快捷方式、暂停 Gmail 计划均未变化；原仓库 HEAD 仍为 ec39d740，唯一未跟踪项仍为原暂停计划。
- 本轮早期自动化曾因 textarea 标签定位和长页截图超时失败，证据保留；最终采用 textbox 可访问名称和 Electron capturePage，最终候选重新完整通过。未将失败轮次算作通过。

后台验证：`node scripts/verify-native-unified.mjs`。原生复验会打开窗口，应在有当次授权时运行：先 `node scripts/seed-native-unified-fixture.cjs` 生成新隔离库，再 `node scripts/native-unified-acceptance.mjs output/native-acceptance/final-package-manifest.json`。

没有安装软件、创建/复制凭据、付费音乐生成、接受新协议、腾讯上传/正式提交、远程 Git 推送、部署或替换日用入口。
