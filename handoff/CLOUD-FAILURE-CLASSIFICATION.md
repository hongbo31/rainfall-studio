# Linux 离线集成测试：32 项失败逐项分类

核对时间：2026-10-18 UTC。范围只限已有日志、源码、构建产物与隔离测试数据库；未修改应用或测试源码，未连接真实账号、平台或原 Windows 主机。

## 结论

两次运行均为 202 项测试、170 通过、32 失败，失败测试身份完全一致。第一次使用 `tests/fixtures/offline-only.cjs`，第二次使用 `/tmp/rainfall-offline-media.cjs`。不能把这 32 项解释为 32 个业务回归，也不能据此声称对应业务已经通过。

- **21 项：应用源码硬编码 Windows ffprobe 路径，导入夹具时直接失败。** 这是已定位的跨平台可移植性缺口；本机已存在 `/usr/bin/ffprobe` 并不能让应用自动发现它。
- **9 项：测试夹具直接调用 Windows ffmpeg.exe，被 test-only 子进程保护拒绝。** 第二次放行规则只接受 basename 为 `ffmpeg` / `ffprobe`，仍拒绝 `ffmpeg.exe`；此处错误文本带 NETWORK 并不表示真的发起了网络请求。测试代码本身也存在 Windows 路径依赖。
- **1 项：workflow-client 的异步候选校验失败，高置信来自同一 ffprobe 路径缺口。** 数据库证实文本与质量阶段已完成，失败发生在音频下载/入库阶段；统一异常处理抹去了底层异常，不能把日志中未记录的 errno/错误原文当作已捕获事实。
- **1 项：workspace lease 在本地 socket listen 阶段失败，环境禁止 listen 是强旁证。** 旧日志只有应用归一化后的 `WORKSPACE_ALREADY_OWNED`，不能由此断言确有第二个进程持锁；也不能把后来探针的 EPERM 追认成旧运行实际记录的 errno。

## 证据与逐项清单

### A. 应用 Windows ffprobe 路径：21 项直接失败

共同源码路径：`Studio.importFile`（`src/core/studio.ts:1158-1159`）→ `assets.importFile`（`src/core/assets.ts:102-103`）→ `probe`（`:35-36`）。`src/core/assets.ts:7-10` 固定为 `C:\ffmpeg\ffmpeg-8.1-essentials_build\bin\ffprobe.exe`；`:36` 在调用子进程前执行 `existsSync` 并抛出 `FFPROBE_MISSING`。旧日志对应构建栈是 `build/core.cjs:381 → :424 → :10286`。独立只读检查确认该 Windows 字面路径不存在、`/usr/bin/ffprobe` 存在。

两种保护脚本对此都没有机会起作用，因为路径存在性检查先失败；第二次允许本地 ffprobe 不会解决这一处硬编码。下列测试目标断言均尚未运行到。

1. **primary audio import clears prior confirmation even for the identical managed file**
   - 位置：`tests/integration/cover-lyrics.test.cjs:517:1`
   - 直接原因：测试 :535 首次导入程序生成的 `fixture-silent.wav` 即失败；未到相同 managed file 再导入及歌词确认清除断言。
2. **lost acknowledgement survives restart and never repeats commit**
   - 位置：`tests/integration/queue.test.cjs:81:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
3. **safe failure retries only failed step and settles one submission**
   - 位置：`tests/integration/queue.test.cjs:103:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
4. **verified simulation TME grouping commits once but counts both target buckets**
   - 位置：`tests/integration/queue.test.cjs:122:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
5. **review rejection does not refund quota or imply live**
   - 位置：`tests/integration/queue.test.cjs:136:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
6. **revoking binding after approval prevents the next remote boundary**
   - 位置：`tests/integration/queue.test.cjs:153:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
7. **submission crossing midnight must use execution day bucket**
   - 位置：`tests/integration/queue.test.cjs:163:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
8. **backup freezes running plans and invalidates queued execution approvals**
   - 位置：`tests/integration/queue.test.cjs:180:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
9. **safe commit retry reuses already prepared and uploaded results**
   - 位置：`tests/integration/queue.test.cjs:192:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
10. **manual receipt is explicit user evidence, independently records review/live, and never submits**
   - 位置：`tests/integration/queue.test.cjs:206:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
11. **restored paused simulation can be prechecked and approved again without restoring old approval**
   - 位置：`tests/integration/queue.test.cjs:234:1`
   - 直接原因：共享 `ready()` 夹具在 `queue.test.cjs:47` 导入本地 `qa.wav` 失败；`:49-68` 的账号、绑定、发布计划和批准初始化尚未执行，故本项队列/回执语义未得到验证。
12. **quick defaults choose only a unique eligible artist/account binding; expired and ambiguous require inline choice**
   - 位置：`tests/integration/quick-publish.test.cjs:21:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
13. **paired audio needs explicit scope; B payload and fingerprints use B without modifying library A/B**
   - 位置：`tests/integration/quick-publish.test.cjs:31:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
14. **changed metadata cannot bypass a claimed recording or silently start the other recording**
   - 位置：`tests/integration/quick-publish.test.cjs:48:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
15. **single action starts only ready simulation and preserves separate unknown review/live state**
   - 位置：`tests/integration/quick-publish.test.cjs:59:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
16. **pending rights anywhere blocks simulation and does not silently start partial batches**
   - 位置：`tests/integration/quick-publish.test.cjs:67:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
17. **production never treats local config as verified authorization or sends to a platform**
   - 位置：`tests/integration/quick-publish.test.cjs:73:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
18. **malformed recording scope is rejected before writing a batch**
   - 位置：`tests/integration/quick-publish.test.cjs:80:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。
19. **B video cannot reuse A MP4; matched per-recording videos are selected without altering audio slots**
   - 位置：`tests/integration/quick-publish.test.cjs:87:1`
   - 直接原因：共享 `fixture()` 在 `quick-publish.test.cjs:11` 导入本地 `audio.wav` 失败；后面的 A/B、封面、账号/绑定和快速发布业务断言尚未执行。 本项后续视频准备还依赖硬编码 ffmpeg，但它不是此次最先失败的位置。
20. **media is copied and hash verified across source removal/restart**
   - 位置：`tests/integration/studio.test.cjs:242:1`
   - 直接原因：`studio.test.cjs:248` 首次导入 `writeWav()` 产生的本地 `qa.wav` 失败；尚未进行源文件删除/重启验证或备份恢复断言。
21. **backups restore media and freeze plans and queue; corrupt ZIP preserves current DB**
   - 位置：`tests/integration/studio.test.cjs:256:1`
   - 直接原因：`studio.test.cjs:262` 首次导入 `writeWav()` 产生的本地 `qa.wav` 失败；尚未进行源文件删除/重启验证或备份恢复断言。

### B. 异步音频入库将路径错误折叠：1 项

22. **Core chat -> quality -> two managed original diagnostic assets uses no external requests**
   - 位置：`tests/integration/workflow-client.test.cjs:3:1`；失败断言在 `workflow-client.test.cjs:9`：全部候选应为 `ready`。
   - 已读两次运行的隔离产物：`output/test-runs/workflow-client-1fb8ff0f-15f2-4337-9e9e-1c0d53949456/simulation/library.sqlite` 和 `output/test-runs/workflow-client-39efe828-d016-4086-9b4f-ccd33b68cac2/simulation/library.sqlite`，均以 SQLite `mode=ro` 打开。
   - 两库一致：creative turn=`ready_for_review`；三个 L/M/C 评价均 `complete`；music operation=`polling`，reason=`OUTPUTS_PENDING_OR_DOWNLOAD_FAILED`，queryErrors=0；恰有两个候选，均 `download_failed`、downloadAttempts=1、assetId=null；assets 表为空。
   - 源码链：`studio.ts:416-422` 异步 submit→reconcile；`workflow/simulation.ts:123-171` 使用注入的内存 request，二进制分支返回 `fixtureTone()` 与 `audio/wav`，没有实际远程下载。URL 与 `yourmusic.ts:20-31` 白名单一致；`:282-315` 接受该 WAV MIME/Buffer。`music.ts:408-410` download→ingest；`studio.ts:178-198` 写隔离 staging 后调用 `importFile`，该路径必经 A 组的 Windows ffprobe 检查。`music.ts:420-425` catch 不保留原错误，只写 `DOWNLOAD_OR_AUDIO_VALIDATION_FAILED`。
   - 判定：高置信为同一硬编码路径阻断，而不是候选没创建、质量未通过、网络请求被防护拦截或歌词去敏导致。直接底层异常在旧产物中已经丢失，仍需可移植媒体路径下的重跑才能最终验证全链路。

### C. 测试夹具的 Windows ffmpeg 被进程保护拒绝：9 项

第一轮 `tests/fixtures/offline-only.cjs:11-12` 禁止所有 child_process 方法，因此本地夹具 ffmpeg 也会抛 `OFFLINE_UNIT_NETWORK_FORBIDDEN`。第二轮 `/tmp/rainfall-offline-media.cjs:7-8` 只接受命令 basename 恰为 `ffmpeg` 或 `ffprobe`；这些夹具传入的 basename 为 `ffmpeg.exe`，因此在调用原 execFileSync 前就抛 `OFFLINE_CLOUD_NETWORK_FORBIDDEN`。第二轮堆栈精确停在白名单第8行，不是后续 URL/协议检查。全部命令只意图用 `lavfi` 产生本地正弦测试音，不能把这个错误当成业务尝试联网的证据。

同时，`C:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe` 本身在 Linux 不是该程序的可用路径；即使调整进程白名单，也不能直接保证这些测试通过。它们稍后的 `Studio.importFile` 仍会遇到 A 组缺口。

23. **local MP4 has actual video/audio, vertical work preset and full source duration**
   - 位置：`tests/integration/media-migration.test.cjs:51:1`
   - 直接原因：`media-migration.test.cjs:65-78` 直接 execFileSync Windows ffmpeg，准备 1.2 秒 WAV 时被拒；未到 :84 音频导入、:86 MP4 打包和 :90-97 视频/时长/复用断言。
24. **review1: media probe rejects local playlists before opening nested references**
   - 位置：`tests/integration/review-regressions.test.cjs:128:1`
   - 直接原因：`review-regressions.test.cjs:133-150` 准备用于本地 playlist 的 MPEG-TS 音频时被拒；未写出 :151-154 playlist，未到 :155 的 probe 拒绝断言，因此本轮没有实际验证 playlist 安全防线。
25. **review2: old batch material metadata/lyrics remain frozen after draft changes**
   - 位置：`tests/integration/review-regressions.test.cjs:157:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。
26. **review3: manually accepted recording blocks a second account route to the same target**
   - 位置：`tests/integration/review-regressions.test.cjs:180:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。
27. **review4: older observations remain history without replacing accepted time or newer live state**
   - 位置：`tests/integration/review-regressions.test.cjs:207:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。
28. **review5: manual receipt after cancellation records one actual count despite released reserve**
   - 位置：`tests/integration/review-regressions.test.cjs:226:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。
29. **review6: completion cannot bypass pending manual candidate/cover checkpoints**
   - 位置：`tests/integration/review-regressions.test.cjs:250:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。
30. **review6: completion verifies media bytes and rejects wrong artist plan ownership**
   - 位置：`tests/integration/review-regressions.test.cjs:256:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。
31. **review6: finishing confirmed scheduled run credits its original goal date**
   - 位置：`tests/integration/review-regressions.test.cjs:286:1`
   - 直接原因：共享 `review-regressions.test.cjs:64-77` 夹具启动 Windows ffmpeg 生成 `qa.wav` 时被拒；未到 :83 媒体导入、:85 起账号/发布计划准备及本项目标回归断言。

### D. OS workspace lease / sandbox listen：1 项

32. **OS workspace pipe lease excludes second writer and releases without PID timeout stealing**
   - 位置：`tests/integration/workflow-runtime.test.cjs:3:1`；测试主体集中在 :4。
   - `src/main/session-runtime.ts:5-16` 对 workspace/user identity 做 hash，Linux endpoint 是 `/tmp/rainfall-<hash>.sock`。`:15` 将所有 `server.listen` 的 error 无差别改为 `WORKSPACE_ALREADY_OWNED`；旧日志只含 `output/workflow-build/workflow.cjs:2496` 的映射后异常，未含 `err.code`。
   - 两个测试保护脚本只覆盖 `Socket.prototype.connect`，没有覆盖 `Server.listen`。因此本项与 C 组的 test-only child_process 拦截机制不同。
   - 主任务已提供独立最小探针结果：`net.createServer().listen('/tmp/rainfall-lease-probe-'+process.pid+'.sock')` 返回 `code=EPERM`、`syscall=listen`、`listen EPERM: operation not permitted /tmp/rainfall-lease-probe-5.sock`。该探针没有启动业务、没有外部通信，支持此 sandbox 禁止本地监听的判断。
   - 判定：环境 listen 限制是强旁证，不能从旧日志证明实际持锁，也不能恢复旧错误 errno 或确定旧测试是在首次 acquire 还是 release 后再次 acquire 失败。应用将权限/路径/地址占用错误全部说成“已被占用”是已确认的诊断信息损失，但本次没有修改它。

## 真实回归与去敏夹具的边界

- 这32项的**已观察到的最先失败点**，没有一项证据指向发布去重、回执、日期配额、歌词对齐或权利校验的业务逻辑回归。30项在夹具/媒体前置阶段就失败；workflow-client 的文本和质量评估已成功，音频入库失败；lease 另有底层 listen 限制旁证。
- `SANITIZATION-MANIFEST.json` 的 redactedFiles 明确包括 `tests/integration/quick-publish.test.cjs`，因此其后续业务断言仍须重新核验；但本次8个 quick-publish 失败均发生在 :11 的 WAV 导入，不是替换后的歌词/身份断言。其余本文涉及的集成测试文件未列于 redactedFiles。
- 不能排除被前置失败遮住的真正回归、fixture 变更或 Node/Electron 行为差异。这些是**未验证部分**，不能为了归类强行判成“都只是环境、可忽略”。源码可移植性缺口本身已成立；是否为相对 Windows 基线新增回归，源码快照不含 Git 历史，无法判断。
- 两次运行使用 Linux Node 替代默认 `scripts/run-tests.mjs` 的 Electron runner，不是 Windows 原生验收。当前结论只解释这两份日志，不覆盖真实浏览器、UIA、上传、协议勾选或正式平台提交。

## 复核依据

- `/tmp/rainfall-node-integration.log`：202 / 170 / 32，summary 在 :204-211。
- `/tmp/rainfall-node-media-integration.log`：202 / 170 / 32，summary 在 :204-211，32个详细失败块位于 :215-561。
- `tests/fixtures/offline-only.cjs` 与 `/tmp/rainfall-offline-media.cjs`：两轮保护边界。
- `src/core/assets.ts`、`src/core/studio.ts`、`src/core/workflow/{music,simulation,fixture-audio,yourmusic}.ts`、`src/main/session-runtime.ts` 和逐项列出的测试文件。

后续若修复跨平台媒体定位，应保留断网、固定媒体工具和 `file,pipe` 协议限制，并先重跑这些被遮住的断言，再作业务通过结论。不能仅把32个失败标成 skipped 或去掉安全保护以取得绿色结果。
