# 0.7.2 原生异常调查与验收保护

本次处理用户截图中的 `RainfallStudioCandidate.exe`、`0x80000003`、地址 `0x00007FF72F13C2B9`。这是本地诊断与验收保护更新，不宣称已解决所有 Electron 原生崩溃。

## 证据与结论边界

- System / Application Popup 26，RecordId 293427：2026-10-16 20:21:01.190374 UTC，即北京时间 2026-10-17 04:21:01。错误代码、地址和截图一致。
- `output/beijing-tme-ai-flow-gui.log` 对应旧隔离验收包 `beijing-tme-ai-936a1e399167-1792182055905`，实际应用 PID 47476。六次 GPU 辅助进程启动失败，退出 `-1073741515 / 0xC0000135`，随后 Chromium `gpu_data_manager_impl_private.cc:417` 记录 `GPU process isn't usable. Goodbye.` 并触发致命异常。
- 该失败发生在受限工具的隔离桌面启动。现有交付进程 PID 34176 于北京时间 04:27:24 启动，晚于错误事件约六分钟；09:09 只读检查证实它仍运行，并在09:00产生当日唯一候选。不能把旧系统错误窗当作该新进程刚崩溃。
- 本次未点击或终止原错误窗。09:55 可见，09:59:40 再查已消失，PID 34176未变。没有拿窗口消失当修复证据。
- `0xC0000135` 是辅助进程启动的缺少依赖类错误；没有故障 DLL 名、栈或 dump，不能据此认定显卡硬件、驱动或内存故障。
- 原生 Application 1000/1001、所属 WER 及 Crashpad dump库存为空。之前最小 Electron 受限运行也有 GPU启动失败；更早09:40/09:51弹窗缺少一一配对栈，不能断言全部同因。
- 实测工具的隔离桌面是 `CodexSandboxDesktop-*`，正常客户端/授权桌面工具是 `WinSta0/Default`。两者均可有 `HasRestrictions=true`，该标记单独不能鉴别正常运行条件。

证据保存于 `output/native-crash-20261017/`：原始stderr、事件XML/时间、进程清单、空dump/WER清单和窗口复核结果。没有复制凭据。

## 最小变更

1. GUI验收启动前确认PowerShell7、交互会话、WinSta0/Default桌面、非AppContainer和至少medium完整性。只记录HasRestrictions，不用它单独拒绝已证实正常环境；隔离桌面直接拒绝，应用尚未启动。
2. 每次启动独立记录Application/System事件游标、开始/结束时间、候选EXE路径和PID。启动失败、关闭超时也执行原生事件检查；不把历史弹窗归入新轮次。
3. 启动、检查、关闭均设时限，只清理自己启动的实例。renderer无异常不再足以通过。
4. 应用启用本机Crashpad报告，`uploadToServer:false`，没有提交URL；补充Main生命周期、子进程/renderer退出原因和有限异常码。日志在原数据根 `diagnostics/native-lifecycle.jsonl`，单文件约1MiB、最多三个文件，写失败不会引起应用失败。不会记录凭据、原始错误消息、业务正文。
5. 验收同时读取本轮生命周期日志，发现子进程启动失败/崩溃等也判失败，不依赖Windows是否生成报告。

不新增GPU参数，不关闭沙箱，不安装软件。原数据根、桌面入口、作品素材、09:00候选和腾讯待条款状态必须保持；真实模型扣费、接受条款、正式投稿不在本次操作范围。

## 验证与交付

2026-10-17北京时间10:14完成交付验证：

- 类型检查、桌面构建通过。Core174、生产流水线24、日程UI4、腾讯准备29、Main broker16、腾讯准备UI8、基础3、原生诊断3、Windows QA保护22，共283项通过。保护测试包含关闭后Playwright dispatcher失效的真实边界；失败轮次保留为 `flow-gui-close-infrastructure-failure.json`，未冒充通过。
- 本机受限隔离桌面预检被正确拒绝，Electron尚未启动，见 `restricted-desktop-negative.json`。Default宿主桌面四轮隔离客户端启停、创作主流程10项及腾讯终态/日程6项通过；renderer错误、外部HTTP、原生输入调用及原生异常均0。
- 隔离报告 `output/native-crash-20261017-flow-gui-verification.json`、`output/native-crash-20261017-gui-verification.json`。每轮同时具备entry、ready、本机Crashpad启用、quit(0)，本轮Windows事件及生命周期异常为空。
- 更新原桌面 `C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk`，仍复用原dataRoot。实际包为 `out/beijing-tme-ai-09ba41814c62-1792202654040/RainfallStudioCandidate.exe`，版本 `0.7.2-preview.1`，程序源码 `09ba41814c62bd1e7fd7e3c33ca3045c6dc994fd`；之后提交仅改QA和文档。没有远端推送。
- 同入口四次启动PID依次23216、4480、32596、40168；前三次正常关闭均quit(0)，每轮新原生异常及子进程异常0。最终40168保持待条款页面，额外点击同快捷方式复用40168、启动时间不变、只有一个自有主窗口。记录 `desktop-cycle-1.json` 至 `desktop-cycle-4.json`、`same-shortcut-reuse.json`。
- 原《示例作品A》A实际播放至0:01/3:30后暂停，封面可见。最初窗口被最小化，UIA操作和小图未算通过；恢复Normal后重新导航并完成2160×1500原生窗口截图。`output/native-crash-20261017-play-A.png`、`output/native-crash-20261017-final-terms.png` 已人工检查，待条款状态明确，未操作官网。
- 与升级前一致性快照逐行比较：真实库54行、模拟库14行未变（仅排除运行时日程心跳）；真实作品1、素材4、操作7、候选2，所有素材SHA256一致。今日候选 `bac65ea4-bef3-4da2-8477-a727413c916e`仍awaiting_approval；腾讯任务revision20、awaiting_terms_review、未接受条款、未正式提交。见 `data-verification.json`。
- 回退副本 `output/native-crash-20261017-delivery-backup-1792202571403`，包括SQLite一致性快照、四份素材、旧指针、启动脚本和快捷方式，不含凭据。没有新生成扣费、DeepSeek请求或平台发布。

以上证明本次条件下新版可启动、退出和使用，并堵住了失败验收被忽略的路径。没有得到原故障DLL或dump，不能宣称消灭所有未来0x80000003；若正常Default桌面再次出现，须按新生成的本机Crashpad/生命周期证据继续定位。
