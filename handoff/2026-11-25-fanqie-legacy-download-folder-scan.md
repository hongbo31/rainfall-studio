# 2026-11-25 番茄下载目录扫描与诊断

## 最新结论

用户已明确：下载目录格式一直是 `<账号>_<歌手>_<提示词>`。此前根据截图猜测为不带提示词的旧目录，并据此加入旧格式兼容，是错误判断；不能把它作为“没有可上传歌曲”的已确认原因。本机 `%LOCALAPPDATA%/RainfallStudioLauncher/verified-desktop.json` 缺失，仍无法安全核对第 63 次运行的真实配置快照、下载根路径和日志，也未访问 `G:\AI音乐`。

## 最新改动（2026-11-25）

`src/core/fanqie-downloads.ts` 现在按固定目录约定识别歌手目录：账号前缀匹配后，以最长的已配置歌手名加下划线定位歌手，并要求后面有非空提示词后缀。提示词本身可以包含下划线，因此不按固定三段拆分，也不要求提示词必须等于当前模板名（已有目录可保留生成时的提示词名）。移除了误加的 `<账号>_<歌手>` 旧目录匹配和未匹配目录按首段猜歌手的回退；A/B 同名冲突目录 `_B` 仍支持。目录内音频、歌词、封面及其他材料校验不变。

这次收紧只修正目录格式匹配，不能单凭静态代码确认它就是第 63 次扫描为空的原因。若仍无候选，需从新版扫描 trace 核对 `rootEntryCount`、`accountDirectoryCount`、`matchedArtistDirectoryCount`、`audioCandidateCount`、`readyCount` 和 `issueCounts`。

此前确认上传后遭拒的歌曲仅在官网回执核对通过且表单歌曲删除后进入素材回收节点；扫描为空会在该节点之前停止。扫描逻辑本身不会移动、删除或恢复用户文件。

## 验证与限制

- 仅做静态代码复核和定向 `git diff --check`；未运行测试、构建、客户端或真实投稿。
- 未读取生产运行记录、访问 `G:\AI音乐` 或做 Windows 原生验收；现有安装版尚未包含本次改动。

## 回退

恢复 `singerForFolder` 原有按歌手前缀匹配及未匹配目录回退逻辑，并移除本次项目交接条目。该代码变更本身不会移动、删除或恢复任何用户文件。

## 2026-11-25 扫描诊断补充

用户再次反馈扫描为空后，补充将空扫描细分：根目录未找到当前番茄账号子目录时返回 `FANQIE_DOWNLOAD_ACCOUNT_FOLDER_NOT_FOUND`；账号目录存在但没有可匹配歌手目录时返回 `FANQIE_DOWNLOAD_ARTIST_FOLDER_NOT_RECOGNIZED`；账号/歌手目录已匹配但没有 WAV/MP3 时返回 `FANQIE_DOWNLOAD_AUDIO_NOT_FOUND`。单首范围扫描若目标歌曲已不在扫描结果中，则返回现有 `FANQIE_DOWNLOADS_CHANGED`，不再返回空项目列表。

补充改动涉及 `src/core/fanqie-downloads.ts` 与 `src/shared/fanqie-downloads.ts`。此诊断能帮助下一次运行判断是配置根目录/账号前缀/歌手目录还是音频文件格式问题；它不能回溯解释第 63 次运行，因为 `verified-desktop.json` 仍缺失，且当前安装版没有应用本轮源码。未运行测试或构建；仅执行定向 diff 检查。下载素材未被扫描代码移动或删除。

回退时一并移除新增的三个错误码分支及共享提示，并恢复空范围扫描原行为；本轮文件不影响本地材料。

## 2026-11-25 分阶段扫描日志

用户再次反馈配置下载目录仍提示没有可上传歌曲。当前 `%LOCALAPPDATA%/RainfallStudioLauncher/verified-desktop.json` 缺失，无法按桌面指针安全定位正在使用的生产库和第 63 次运行日志，也没有访问 `G:\AI音乐`。因此不能据此断言当前账户配置或磁盘目录的实际匹配结果；本轮改为让下一次扫描直接给出阶段证据。

`readFanqieDownloadArchive` 现在按账号/艺人配置、下载根目录解析、根目录枚举、账号目录匹配、歌手目录匹配、音频候选扫描、材料校验和结果汇总记录步骤状态。日志只包含计数、错误码和材料拦截原因，不写本地路径、账号名、目录名或歌曲文件名。预检日志写到该运行 `download-runs/<运行 ID>/trace.jsonl`；扫描页即使没有批次，也显示“打开扫描日志”。扫描错误会随预览返回，界面和计划状态可区分当前账号目录不存在、歌手目录不匹配、无 WAV/MP3、根目录不可读和材料全部被拦截。批次最终过滤阶段还统计本地上传回执导致的阻断原因，不清除或绕过上传 JSON。

改动涉及 `src/core/fanqie-downloads.ts`、`src/main/fanqie/directory-run.ts`、`src/main/fanqie/directory-trace.ts`、`src/main/fanqie/upload-broker.ts`、`src/shared/fanqie-downloads.ts`、`src/renderer/components/FanqieDownloadUpload.tsx` 和 `src/renderer/plan-execution-labels.ts`。仅做静态代码复核和 `git diff --check`；未运行测试、构建、桌面客户端、真实上传或访问 G 盘。现有安装版未更新，必须后续构建候选并按桌面交付流程验收后，这些日志才会出现在实际客户端。下一步如仍失败，读取对应运行的 `trace.jsonl`，依次核对 `rootEntryCount`、`accountDirectoryCount`、`matchedArtistDirectoryCount`、`audioCandidateCount`、`readyCount` 和 `issueCounts`。

回退：恢复扫描器的直接抛错与旧归档类型；恢复 `directory-run.ts`、`directory-trace.ts`、`upload-broker.ts`、扫描页和 `plan-execution-labels.ts` 的原日志入口及错误映射；移除共享预览的 `hasDiagnostics` 字段、扫描失败提示及本节。日志修改不移动或删除任何下载目录文件。

## 2026-11-25 扫描结果与上传状态诊断

用户追问下载根目录有大量歌曲但计划仍提示没有可上传歌曲。确认 `FANQIE_DOWNLOADS_EMPTY` 在计划启动时也可能表示“扫描到候选，但所有歌曲均有 issue”，而非磁盘上没有文件。`previewInputs` 会依据本地番茄上传任务 JSON 对匹配的目录/音频记录标记“官网已存在”或“需要核对”，材料校验也会标记缺封面、缺歌词、格式/大小不符等原因。

现将零可用项区分为两种结果：扫描没有候选项目仍报 `FANQIE_DOWNLOADS_EMPTY`；存在候选但全被拦截则报 `FANQIE_DOWNLOADS_NONE_READY`。对应 `directory:scan` trace 增加按错误码汇总的 `issueCounts`，只记录错误码和数量，不记录路径或文件名；安全白名单最多保留 24 种原因。不会自动删除、清空或绕过任何历史上传状态，以免重复投稿或绕过待核对记录。

涉及 `src/main/fanqie/directory-run.ts`、`src/main/fanqie/directory-trace.ts`、`src/shared/fanqie-downloads.ts`。仅做定向 `git diff --check`；未运行测试、构建或桌面验收。现有桌面客户端未更新，需候选版本构建并按交付规范验收后，后续运行才会显示新错误区分及 issueCounts。回退：恢复 `directory-run.ts` 的统一空批次错误及 `directory-trace.ts` 的计数详情白名单，移除新共享错误提示和此节记录。
