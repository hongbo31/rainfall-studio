# Electron 应用程序错误调查（2026-10-16）

状态：已确认真实系统弹窗记录，原始 0x80000003 的根因尚未确定；没有声称修复。

## 已核实证据

- 机器 SOURCE_WINDOWS_HOST。本机时钟为 UTC+08:00；原始 JSON 时间统一使用 UTC。
- System / Application Popup / 26 共找到 9 条相关记录（最近七天）：8 条 `electron.exe`、1 条 `RainfallStudio.exe`，均为 `0x80000003`。
- 最近两条为 2026-10-16 09:40:11.782Z、09:51:16.478Z（本机 17:40:11、17:51:16），记录号 293321、293323，异常位置均为 `0x00007FF7AC5EC2B9`。
- 两个本项目 QA 目录分别创建于 09:40:10.085Z、09:51:15.586Z；对应报告均为 `electronApplication.firstWindow` 超时、检查数 0。弹窗分别晚于 QA 目录创建约 1.70 秒、0.89 秒。**这支持 QA 启动相关性，但弹窗事件没有故障进程路径，不能据此证明具体进程和模块。**
- 2026-10-15 17:58:08.202Z（本机次日 01:58:08）的记录明确显示名称 `RainfallStudio.exe`，不能把所有历史错误归咎于其他应用或仅归咎于今日候选版。
- Application / Application Error、Application Hang、WER 中，近三天没有指向 Rainfall 或 electron.exe 的相应崩溃记录。10 月 14 日的两组 Codex / ChatGPT.exe 挂起属于不同记录，不能用来解释上述弹窗。相同事件 ID 的 Codex sandbox service 启停消息不是崩溃。
- 已查看已知 Rainfall 数据目录的 `runtime/crashes` 和运行日志元数据，没有可供定位的崩溃转储或持久化启动日志。没有启用上传或采集用户凭据所在内存。

## 当前运行实例和隔离检查

- 用户候选版主进程 PID 38288，路径为 `out/tme-readiness-f98b20328ab4-1792145753240/RainfallStudioCandidate.exe`，18:27:12 本机时间启动；其 GPU、Network Utility、Core Utility、renderer 子进程仍存活。此次调查没有结束或重启该实例。
- 用户配置页可见文本为“谱乐 AI · 个人音乐创作 / 已保存 · 未验证”，安全状态 `configured: true`。没有读取输入框值、解密/复制凭据或截图。
- 开发 Electron 和候选 EXE 均为 Electron 44.7.2，SHA-256 完全相同：`1f41127064012c5e74422b2e0dfc35ff0b0fe8d7908b97d01503becd1b7fa9e1`。旧桌面包 EXE 为定制资源版本 0.5.0.2，路径和 SHA 不同，不能混同。
- 受限工具环境中的最小隔离 Electron 启动失败：GPU 子进程 `-1073741515`（0xC0000135），renderer `launch-failed / 49`，主程序以 1 退出。这**不是**原始 0x80000003 的相同复现。
- 同一最小程序在正常 Windows 用户环境中，完成 renderer 加载及正常退出（exit 0）。
- 本项目实际 `build/main.cjs` 在正常用户环境、全新隔离目录中完成窗口创建、页面 `did-finish-load` 和正常退出（exit 0），包含 Core 和现有原生模块启动。该结果不能保证间歇性故障已消失。
- 带 Playwright 的隔离探测存在启动/关闭时序问题：一次首窗口超时；一次拿到窗口标题及进程信息，但在页面加载完成前关闭，出现 `ERR_FAILED`。因此**不把该探测标为界面通过或原错误修复**。
- 正常退出的实例也有 DirectComposition 接口查询警告，因此仅凭该警告不能断言 GPU 驱动是根因。
- 调查结束时未遗留本次诊断 electron.exe；仅保留原用户候选版及其子进程。未清理配置、升级依赖、改系统安全开关、覆盖桌面版或启动音乐付费请求。

## 证据位置（output 为本机保留、Git 忽略）

- `output/electron-system-popup-events.json`：系统弹窗时间、错误内容和记录号。
- `output/electron-system-popup-raw.json`：原始事件 XML。事件执行 PID 为系统报告方，不能当作故障进程 PID。
- `output/electron-application-events.json`：匹配关键字的原始 Application 记录；须同时按 Provider 判读。
- `output/electron-process-inventory.json`：本次诊断开始时的进程路径和父子关系，不含完整命令行。
- `output/electron-runtime-binary-metadata.json`：三个 EXE 的版本、路径、大小和 SHA。
- `output/candidate-configured-safe-status.json`：仅配置状态，无密钥。
- `output/electron-diagnosis/restricted-1792148188195/`：受限环境失败的生命周期、stderr 和 Chromium 日志。
- `output/electron-diagnosis/normal-user-1792148203825/`：最小正常用户启动及退出记录。
- `output/electron-diagnosis/full-normal-1792148328416/`：实际开发构建正常加载、退出记录。
- `output/electron-diagnosis/playwright-launch-debug.log`：仅隔离诊断实例的启动记录，不含用户配置。

## 未决范围和下一步

### QA 与正常启动的静态比较（续查）

| 边界 | 正常候选版 | QA / Playwright | 结论 |
| --- | --- | --- | --- |
| 入口 | 直接 `Start-Process` 指向候选 EXE | Playwright 1.64.1 的 Windows 实现构造 shell 命令，再 `shell: true` 启动 | QA 返回的 `app.process().pid` 是包装进程，不能当作实际 Electron Main PID |
| 参数 | 应用正常入口 | 自动加入 `--inspect=0`、`--remote-debugging-port=0`，指向生成的 QA Main | 参数仅用于本项目隔离 QA，不能复用于第三方登录浏览器 |
| 数据 | 独立候选数据目录 | 每次新建隔离 QA 目录 | 不能仅因相同 Electron 可执行文件就判定数据目录冲突 |
| 锁 | `requestSingleInstanceLock` 加按数据根计算的 workspace pipe lease | 同一 Main 实现 | 已有代码具备工作区互斥，不支持无证据的“多开导致”结论 |
| 图形 | `disableHardwareAcceleration()`，renderer sandbox 开启 | 同一设置；旧 QA 还曾隐藏抓图 | 正常启动也出现 DirectComposition 警告，不能凭此锁定显卡原因 |
| 模块 | 同一已安装 Electron 与 SQLite/sharp 依赖 | 同一模块 | 正常实际构建和既有 native smoke 都能加载，暂无 ABI 不匹配证据 |
| 退出 | 用户窗口关闭后走 Main 的 Core close / app.quit | 旧 QA 超时后 `app.process().kill()` | 可能只杀 shell 包装层，不能保证 Electron 清理。**这是独立的 QA 清理缺陷，不是已证明的原生异常根因** |

证据：本地 `node_modules/playwright-core/lib/coreBundle.js` 第 45668 行附近添加调试参数，第 45702 行设置 Windows `shell=true`，后续将 `launchedProcess` 返回给 ElectronApplication。隔离探测中启动包装 PID 13688，但 Main 生命周期和 `getAppMetrics()` 报告 Browser PID 38920，符合该实现。该次检查提前关闭，不能作为完整 GUI 验收。

此次续查没有为原故障再反复运行 QA，没有改变 Electron sandbox、GPU 安全策略、全局 WER 或原生模块版本。后续 GUI 验收优先使用已授权的正常 Windows 窗口操作，保留真实 PID/路径。由于没有同一 0x80000003 的新复现或调用栈，未向生产 Main 添加猜测性“修复”。

尚缺原始 0x80000003 发生时的故障 PID、完整 EXE 路径、故障模块/偏移和调用栈。现有证据支持优先调查 QA 启动环境和 Electron 子进程初始化，不能证明是业务数据、密钥、SQLite ABI、GPU 或某个特定系统组件导致。

若弹窗再次出现，应保留弹窗，读取其窗口所有者及对应进程路径；优先在无用户凭据的独立诊断目录中采集 native stack。不要自动对真实设置实例采集内存转储，不要用禁用 sandbox、重装或清配置作为未经验证的修复。音乐生成调试仍暂停；具体付费上限未确认，未进行两首真实生成，也没有新作品发布。

### 已修复的独立 QA 清理缺陷（2026-10-16）

`tme-live-desktop-qa.mjs` 已移除对 `app.process().kill()` 的依赖。每次 QA 使用随机独立入口、owner UUID 和 data/runtime；Main 启动首段代码立即保存实际 Main 的可执行文件、PID 和原生 FILETIME，避免把 cmd 包装 PID 当成 Main。正常关闭有明确等待上限，超时、失败及 SIGINT/SIGTERM 共用可重复调用的清理过程。

Windows 清理器以实时命令行中的 owner/入口验证 Main，以精确 `--user-data-dir=<本次目录>/data/runtime` 验证 worker，逐个核对同一 EXE 与原生创建时间，持有进程句柄后再终止，防止 PID 被重用。磁盘快照的 `processes` 图只供观察，不参与终止授权；Main 已退出时仍按本次独立目录发现晚启动的 worker。结束前重新扫描，存在匹配进程则返回 incomplete，拒绝验证或清理失败也使 QA 报告失败。没有按进程名批量终止或针对其他 Electron 实例清理。

- 新增回归先复现审查中的两项 Important：伪造中间父节点导致另一测试树的真实子进程被误选；Main 退出后遗漏晚启动子进程却报告 cleaned。随后修复并通过。
- `node --test tests/qa/owned-cleanup.test.mjs`：7/7 通过，覆盖正常关闭、超时、取消信号、启动失败、伪造父子图、晚启动孤儿进程、owner/创建时间篡改。测试实际通过 Windows cmd 包装启动无 GUI PowerShell 树，断言实际根 PID 不等于包装 PID，并保留另一棵同 EXE 测试树。没有把这些测试称为完整 Electron GUI 验收。
- 独立代码复核：此前两项 Important 已解决，未发现新的确定问题。复核提醒 PowerShell fixture 的 runtime 参数是测试主动添加，不能单独证明所有 Electron worker 参数传播。
- 补充只读实际候选进程证据：PID 39976 的 GPU、两个 utility（含 Core）和 renderer 均带同一预期 runtime 参数；Main 按 owner/入口验证，不要求普通候选版带 QA 参数。该证据验证本机当前观察到的 worker 类型，不泛化为未来新增进程。没有为此重新启动 GUI QA 或结束候选版。
- 最终测试树残留 0，正常候选 PID 39976 仍响应。脱敏证据 `output/qa-owned-cleanup-final-preservation.json`；测试日志 `output/qa-owned-cleanup-review-green.log`。MJS 语法检查及 PowerShell parser 通过，git diff --check 通过。

此修复只处理已经证实的 QA 进程清理错误；**没有证明或声称修复原生 0x80000003**。原故障所需路径、模块/偏移和调用栈仍缺失。
