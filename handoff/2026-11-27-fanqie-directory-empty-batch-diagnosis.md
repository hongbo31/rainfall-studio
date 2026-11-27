# 番茄目录上传误报“没有歌曲”

日期：2026-11-27（北京时间）

## 现象与证据

用户提供的扫描日志对应的目录扫描正常完成：根目录有 2 个条目、匹配到 1 个账号目录和 1 个艺人目录、找到 2 个音频候选，2 首均通过素材预检（`readyCount: 2`）。因此这不是 MP3 扩展名、目录深度或账号目录匹配问题。

后续官网目录/艺人查询成功，但两首都在 `directory:materials` 以 `FANQIE_RECONCILIATION_REQUIRED` 失败；批次选择记录 `candidateCount: 2, batchSize: 0`。旧日志没有写入失败歌名和内部判断分支，故不能断定两首分别是已有未决音频任务、重复音频哈希，还是仍打开的上传编辑页。代码中这些情况会使用同一错误码以避免自动重复投稿。

误报根因已确认：`directory-run.ts` 把 `FANQIE_RECONCILIATION_REQUIRED` 和官网确认已存在的记录一起放入 `duplicateReasons`，并统一标记为 `skipped`。无歌曲进入批次后，计划发布器将“完整但全部跳过”折算为 `FANQIE_DOWNLOADS_EMPTY`，于是显示“下载目录中没有可上传的歌曲”。

## 修改

- `src/main/fanqie/directory-run.ts`：只把官网已确认存在的作品标成跳过；待对账歌曲改为 `needs_review`，空批次持久化为 `needs_review` 并携带具体问题。为逐首材料阶段日志记录标题、失败阶段；安全地标注已有音频任务、上传编辑页仍打开、重复音频哈希等可区分原因。
- `src/main/fanqie/plan-directory-publisher.ts`：批次含待核对歌曲时向计划中心返回阻塞状态，避免报“目录为空”。
- `src/main/fanqie/directory-trace.ts`：仅允许白名单失败阶段/原因进入脱敏诊断文件。
- `src/shared/fanqie-downloads.ts`：将对账提示改为说明暂停是为防止重复投稿，并要求查看歌名和失败阶段。
- `src/renderer/plan-execution-labels.ts`：为“扫描到歌曲但都未能安全投稿”提供独立文案，避免再混同为空目录。
- 用户随后提供的 `FM洗脑波2027年DJ爆款纯音乐.mp3` 是 `.mp3` 文件，开头字节为 `ID3`。MP3 原本就在扫描白名单内；用户之前的扫描日志也已经找到 2 首并将 2 首列为 ready，所以这首 MP3 的“无法上传”实际是前述后续对账阻断被空批次误报，不是扩展名不支持。
- `src/core/fanqie-downloads.ts`：扫描器扩展到常见 FFmpeg 可解码格式（FLAC、M4A、AAC、OGG/OPUS、WMA、AIFF、APE、AC3、AMR、CAF、DTS、WV、TTA、TAK、AU、VOC、3GP/3G2 等）。现有准备器将非 MP3 输入转成平台接受的 WAV。
- `src/core/assets.ts`：将上述对应解复用格式加入 ffprobe 白名单。
- 对 `.ncm`、`.qmc*`、`.kgm`、`.kwm` 等识别为加密源格式的文件保留歌曲条目并明确报错，要求从来源平台导出未加密音频；不尝试解密或绕过平台保护。
- `src/shared/fanqie-downloads.ts` 与 `src/renderer/plan-execution-labels.ts`：不再把空目录写成仅支持 WAV/MP3，并展示加密文件的具体原因。

## 影响、验证与限制

- 对外显示的音频目录及账号匹配规则没有变化；官网已存在记录仍然不会重复投稿。遇到已有未决上传、重复音频或未关闭编辑页时会安全待核对。
- 已静态对照用户日志和当前代码路径；本轮未运行测试、构建、可见客户端或浏览器验收。
- 尝试运行 `npm run typecheck`，但当前 PowerShell 环境中 `npm` 不在 PATH，命令未能启动；`git diff --check` 通过。
- 未对附加 MP3 运行 ffprobe/转码，因为当前未发现随源码提供的本机 ffprobe 工具，也没有执行可见浏览器或平台上传。
- 旧日志把多个对账原因折叠为一个错误码，无法回溯分辨具体分支。修改后新执行日志会记录标题、阶段和可识别原因，可据此进一步定位。
- 本工作区另有与本任务无关的未提交改动；本轮只编辑上列五个源码文件及本交接文件，没有覆盖其他改动。
- 当前 `verified-desktop.json` 缺失；没有读取真实账号库或生产目录，也未更新桌面交付入口。

## 回退

只回退本交接记录列出的源码文件改动和本文件对应内容；保留工作区其他已有改动。回退后旧的错误分类会再次把待对账歌曲显示为跳过/空目录。
