# Rainfall Studio 云端离线候选验证

日期：2026-10-18 UTC。版本仍为 0.8.3-preview.2；本次没有安装、发布、更新原桌面入口或推送远端 Git。

## 结论

本轮修复了封面核对中的歌词误判、单次瞬态回显过早放行、裁剪超时后无法只读恢复，以及只读超时后仍在途的原生请求可能与下一次操作竞争的问题。新增用例先复现失败，再验证修复。

这是离线候选，不是 Windows 原生或腾讯端到端验收结果。用户已手动提交的既有作品没有重传、接受协议、再次提交或重试。

## 来源与变更

- 输入：rainfall-studio-cloud-source-ec39d74-sanitized.zip
- 原始来源 HEAD：ec39d740a388f8b42d3cf3024ed8a350382ab64b
- 原始最新逻辑：aa7b0b9e138dfc8d45e1b715df237613d2c80e73
- 隔离本地基线：e3de997（去敏快照的独立本地 Git 记录，不代表上游提交）
- 未修改版本号、锁文件、账号、凭据、作品数据库或用户素材。

### 可执行的 TypeScript / UI 修复

1. 新增 cover-readback.ts：连续至少3次、跨至少200ms的同一身份/页面/材料观测才返回最新封面快照；非就绪状态重置计数；身份、绑定或路由变化立即拒绝；6秒有界等待。
2. ai-prepare.ts 的两条只读核对不再通过整页歌词里的“调整图片”判断裁剪。使用原生控件生成的结构化 manualSelected/generatorBanner 状态，保留原操作、授权、文件哈希与元数据检查。
3. 核对超时后，正在执行的那一次 observe 未结束时继续保留 broker 的 busy 锁。没有全局杀进程；不会在旧请求尚在切换/恢复标签时启动第二次原生操作。
4. broker 与 core 仅将同一受限操作的 MANUAL_COVER_ACCEPTANCE_REQUIRED 加入只读恢复范围；其他未知结果不自动解锁。裁剪恢复仍要求原 picker/crop 证据，不能藉此重新上传或确认。
5. UI 对封面超时、裁剪未确认和页面变化显示短中文操作提示；仍禁用重复写入。

### PowerShell 候选修复：未运行验收

- 智能封面提示可识别最多8个选定 BMP 装饰符号、标点、空白、变体选择符或私用区 iconfont 的前缀；不是任意图标、任意文本的宽松包含匹配。隐藏节点和 Edit 后代仍不构成提示证据。
- 封面按钮证据及点击目标排除隐藏/不可用控件。
- 选图后要求观察到新的裁剪阶段，不以旧封面的 manualSelected=true 判定本次选择成功。没有可关联的新裁剪时有界失败关闭。
- 裁剪确认仍只调用一次；确认后等待连续就绪回显，并返回已接受的快照，不再额外读取一次可能变旧的树。
- 保存专辑步骤仍只是本地材料快照，不调用或声称完成官网保存。
- Crop-Proof 在确认前重新校验 AI editor 路由，防止等待期间同一 SPA 文档导航至其他页面。

## 最终已通过

使用 Node 24.19.0，在隔离云目录，运行 node scripts/test-tme-cover-cloud.mjs：

| 检查 | 通过 / 总数 |
|---|---:|
| 基础 npm test 等价检查 | 3 / 3 |
| 准备核心与集成契约 | 30 / 30 |
| broker / 原操作幂等与恢复契约 | 22 / 22 |
| 提交/回执离线契约 | 16 / 16 |
| 准备 UI 的 SSR 契约 | 9 / 9 |
| 连续稳定只读回显 helper | 12 / 12 |
| 合计 | 92 / 92 |

另：npm run typecheck 通过；npm run desktop:build 通过（现有 bundle 大于500kB的警告仍在）；git diff --check 通过；新增 native 测试 JavaScript 文件的 node --check 通过。构建只生成文件，没有启动 Electron 客户端。

稳定 helper 的确定性时钟测试固定3次读回；真实计时的 broker 测试允许超过3次，只要求至少3次且全为 observe，避免系统定时器略早唤醒导致错误的精确次数断言。

## 未通过、受阻、未运行

### 广域集成：170通过 / 32失败 / 202总数

这不是“全量通过”。完整逐项分类在 CLOUD-FAILURE-CLASSIFICATION.md，原始日志在 cloud-validation/。

- 21项：在 assets.probe 检查硬编码 Windows ffprobe.exe 路径时停止，尚未执行目标业务断言。
- 9项：测试夹具直接启动 Windows ffmpeg.exe，被离线子进程防护拒绝；没有将这些用例判为业务功能通过。
- 1项 workflow-client：文本/质量阶段通过，两个候选停在 download_failed；本地诊断音频导入再度触发上述 ffprobe 路径问题，错误被上层统一包装。
- 1项 workspace lease：代码把 listen 错误统称 WORKSPACE_ALREADY_OWNED，原失败未保留 errno；独立本地 Unix socket 探针明确得到 listen EPERM，支持沙箱限制判断，但不替代原错误日志。

两次广域执行均为 Linux Node 替代 Electron，并增加离线防护。它们不是原机305项的等价复验，也不证明未到达断言的业务路径已通过。没有发现由本次封面修改直接触发的广域回归证据；这些路径仍需在支持媒体工具和进程/管道的环境复验。

### 环境阻断

- 原命令 npm run test:integration 在 Electron 二进制未安装阶段失败；本轮依赖安装使用 --ignore-scripts，没有为补截图启动/安装客户端。
- Windows 原生测试依赖 pwsh.exe、UIAutomationClient/Types、user32 与交互桌面。Linux 不具备这些能力：37项 native 契约/回放未通过执行验证；新增 PowerShell 代码也没有 .NET/PowerShell 解析器验收。
- 云浏览器能够打开 about:blank，但不能连接隔离命令会话的 HTTP 服务（ERR_CONNECTION_REFUSED）；data: fixture 被浏览器 URL 策略拒绝，已停止该路线。两个临时 HTTP 服务已关闭。没有浏览器渲染/真实点击截图，不用 SSR 冒充浏览器验收。

## 仍然保留的边界

- 稳定封面回显仅证明一段时间的可见本地 UI 状态，不证明腾讯持久化、远端文件字节哈希、专辑保存、单曲提交或上架。
- 所有前台、所属窗口、进程、documentId、路由与身份安全检查保留；没有绕过前台激活失败。
- native port 既有 kill 后 Promise 结束的行为未独立验证进程实际退出；本轮修的是 broker 正常在途观察结束前的并发锁，不声称补全进程终止证明。
- 选择歌曲→默认材料准备→真实官方上传→条款/正式提交的完整在线链路仍未完成验收；本轮不会将专辑ID/专辑审核状态当作单曲回执。
- PowerShell 的新增裁剪回放必须在获准的 Windows 隔离测试环境执行，且不得重放已手动提交的作品。

## 复现与回滚

1. 在隔离源码目录安装锁定依赖，运行 node scripts/test-tme-cover-cloud.mjs、npm run typecheck、npm run desktop:build。
2. forward.patch 相对于上述去敏基线；先运行 git apply --check forward.patch，再应用。若目录有用户更改，先保留并解决冲突，不强制覆盖。
3. rollback.patch 只反向撤销本轮改动；先运行 git apply --check rollback.patch，再应用。不要用 reset --hard 或删除用户数据。
4. 归档包含源码、补丁、测试报告和日志；不含 node_modules、构建产物、.git、账号库、素材或登录态。

## 补丁校验与精确文件列表

forward.patch 和 rollback.patch 已在全新基线目录实际应用并反向还原；388个基线文件逐字节SHA-256恢复一致。回滚时Git对源文件既有CRLF行给出空白警告，但apply检查和还原均成功。报告/日志不改动运行逻辑，未纳入代码补丁。

代码补丁包括：

- src/core/tme-ai-prepare.ts
- src/main/tme/ai-prepare.ts
- src/main/tme/ai-uia-host.ps1
- src/main/tme/cover-readback.ts（新增）
- src/renderer/components/TmeAiPrepareWorkspace.tsx
- tests/tme-ai-broker.test.mjs
- tests/tme-ai-native-contract.test.mjs
- tests/tme-ai-prepare-ui.test.mjs
- tests/tme-ai-prepare.test.mjs
- tests/tme-cover-readback.test.mjs（新增）
- scripts/test-tme-cover-cloud.mjs（新增）

逐文件增删行数见交付包 changed-files.tsv，逐文件校验和见 DELIVERY-MANIFEST.json。
