# 《示例作品A》一次真实生成验证

用户已明确同意本次最多使用现有 385 API 积分，不充值、不产生额外付款，并要求按原有温柔恋爱中文流行风格生成。目标为关系系列第4首《示例作品A》，正常模式、chirp-v6、is_max_mode=false，一次请求预期两首 A/B；不发布、不改每日计划。此授权允许一次价格尚未知的验证，不把 v6 定价标为已确认。

项目未存该歌完整歌词，因此创作了完整原创版本，包含主歌、预副歌、副歌、桥段及尾声。源文件 `src/shared/leave-a-light.ts`；温暖男声、钢琴、木吉他、轻鼓、约88 BPM、亲密主歌与抬升副歌、清晰中文咬字、不模仿具体艺人，目标210秒。未使用此前四行测试样本，也未复用《从今天起》的音频。

## 有限客户端接线

此前生产音乐 transport 主动禁用；本次增加独立的一次验证入口，复用原有 MusicService / YourMusicAdapter / Main vault、Core数据库和本地音频导入。`API profile.executionEnabled=false` 与日计划执行状态没有被改为全局开放。

- 现有“AI 聊天创作”页的音乐工作区可保存这次候选，再明确点击一次真实生成。账号设置仅保留配置与连接检查。单次固定授权记录与完整候选先保存，再调用网络；授权绑定 requestId、draft/pairHash、profile/revision、chirp-v6 和385积分边界。
- Core 的 dispatching 与 Main 独占创建的 `production/music-receipts/<operationId>/dispatch.json` 两层防重复。未知结果不重发POST。Main留下规范化受理回执，再交给Core。
- Core重启时把已持久化dispatching恢复为unknown。旧Core/工作区guard贯穿凭据消费和DNS解析后实际发送前。凭据只由正常Main/vault消费，不传入renderer/Core或脚本。
- 查询只跟踪原song ID；若受理回执丢失，只读查询现有历史，按实际dispatch时间、完整歌词、标题及模型唯一匹配两首。匹配不清楚则保留unknown。历史恢复不补造provider task ID。
- 下载仅接受此次结果中的官方OSS地址，经HTTPS、公网地址、大小/MIME及本地ffprobe验证。保存provider task/song ID、提交与实际返回歌词、模型、时长，两个版本再挂到同一作品的A/B槽位。
- 不调用充值或付款接口，不提交平台发行，不接受新协议。未知费用保留为unknown，不把授权预留385积分记作实际消费。

## 提交前验证

- 新授权、正常凭据通道、防重复Main标记、未知结果/重启恢复、延迟提交恢复及相关API配置：25/25通过。
- 原工作流关联回归：36/36通过。首次运行发现测试前置的quality bundle缺失，构建该已有本地模块后全部通过；无软件安装。
- Desktop build、TypeScript检查通过。独立复核发现的dispatching重启和备稿时间窗口问题均补回归并修复。
- 日志：`output/live-music-once-green.log`、`output/live-music-workflow-regression.log`、`output/live-music-typecheck.log`。

本提交是客户端接线与提交前验证，尚不是已经生成成功的回执。实际唯一POST、provider ID、音频文件、播放验证及前后积分以随后运行记录为准。

## 已受理后的下载修复与入口纠正

唯一请求于12:19:38Z经正常客户端提交，provider task为 `9ee945af-aa5e-4558-b51a-6f67cfbc5e15`，两个song ID均已持久化。原生成已经成功，未再次提交。

正常下载被旧MIME白名单拒绝，已用两首自身的官方OSS响应头确认均为HTTP200、`application/octet-stream`，本机ffprobe存在。增加仅限官方OSS `.mp3` 且具有ID3/MPEG文件签名的格式识别，Core仍作完整ffprobe校验。手动按钮只重试原候选音频下载，保留此前下载次数，不调用生成或改变song ID。对应回归先复现拒绝，再验证新路径与HTML拒绝。

用户指出生成入口放在账号设置不合理。此前为联调复用谱乐配置卡，但完整创作流程应属于已有创作页，现已迁到现有ChatCreation的音乐工作区。后台任务、原ID与轮询由Core持久化，不依赖组件挂载。前端热刷新因Windows前台锁未执行任何按键；后续只为下载修复正常重启候选包，并恢复原订单，不以重启为由重发。

## 最终实测闭环（2026-10-16 12:43 UTC）

两首原任务音频已下载、完整解码、正常客户端入库并在重开后试听。前一段MP3签名修复不完整：本次真实OSS结果实际为 `.m4a`、`application/octet-stream`，已再增加官方OSS M4A的ftyp品牌检查；仍由Core对完整文件执行ffprobe，不将扩展名或签名当作音轨验证。M4A修复客户端来源 `f3f85002958bd37cdfbdc23fac1623946913cd7b`，提交生成时客户端来源 `eb84bcf8ba89e1dba4e42dbfa74769a2a7d4ae1c`。

|版本|provider song ID|时长|字节|实际容器 / 音轨|SHA-256|
|---|---|---:|---:|---|---|
|A|1d6405a6-d1e6-4d77-9670-ebe5dd43c15a|210秒|3654057|M4A / Opus，48kHz双声道|2c03abc9b0563f28fc28c39d3da01de888f3404cdbc73d4a82dad692f7d306b8|
|B|c1d124b4-a2fa-4bb5-986c-c55b6a550406|212秒|3694901|M4A / Opus，48kHz双声道|f0c9f39ddb6cdb8b8bdb0e55e67bb0f695c13414381fcb3518b828e81c4a9a77|

- 原task始终为 `9ee945af-aa5e-4558-b51a-6f67cfbc5e15`，唯一生成POST时间为12:19:38.314Z。修复后仅重试原A/B下载，没有新生成POST。
- `ffprobe`确认真实音频轨；`ffmpeg -map 0:a:0 -f null -`完整解码两首，退出码均0且无错误。可读副本与受管原件SHA-256一致，未转码、未将M4A改名为MP3。
- 在正常UI点击“将真实A/B音频导入作品库”，同一个work `00000000-0000-4000-8000-000000000002`挂载两个audio槽位，同标题作品数为1，assetHistory恰为2个原音频ID。提交歌词、provider返回歌词、作品歌词均与747字完整原稿一致，风格与保存稿一致。这是文字元数据核对，未替用户勾选演唱逐行匹配确认。
- 实际桌面播放器截图确认A进度0:07→0:11（总长3:30），B进度0:07（总长3:32）。UIA原生进度属性在该Chromium版本返回陈旧的0:00，因此以实际窗口截图核对进度，未把静态暂停图标当成播放证据。
- 切换作品库和创作页后正常关闭窗口，再用同一数据目录的Launch-Rainfall.ps1重开：原Main6564退出，新Main30528。作品、task/song ID、A/B资产ID均保持；重开后B实际播放至0:07 / 3:32，随后正常暂停。
- 账号设置页实际验证标题“管理你的创作身份。”，无该歌歌词输入；入口位于原有AI聊天创作页。未新增第二个创作页面。
- 12:17:07Z官方登录控制台385积分；12:26:30Z及最终12:43:46Z均380积分。本次观察减少5积分，没有充值、额外付款。没有逐任务扣费账单，因此这是这一次两版本请求的余额差，不作为固定v6单价；Core实际成本字段仍unknown。
- plans和dailyPlans均保持原空表SHA-256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`；本隔离库publication units仍为0，未发行。

最终下载相关工作流测试38/38通过，单次生成防重/恢复测试6/6通过，凭据/API相关25/25通过；Desktop构建和TypeScript检查通过。日志位于 `output/live-music-m4a-green.log`、`output/live-music-final-once-green.log`、`output/live-music-once-green.log`。独立复核此前指出的重启unknown和回执匹配时间问题已修复；最终M4A文件另以真实完整解码及桌面播放验证。

### 本机交付位置

项目：`C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp`。

- 启动：`out/music-live-once-f3f85002958b-1792154094636/Launch-Rainfall.cmd`。请使用启动器以恢复原数据目录；单独运行EXE不会自动选择此原库。
- 数据目录：`out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。真实本地库→作品库→《示例作品A》→A/B试听。
- 易读原音频及歌词、参数、校验记录：`output/deliverables/示例作品A/示例作品A-A.m4a`、`示例作品A-B.m4a`，以及同目录辅助文件；压缩包 `output/deliverables/示例作品A-交付.zip`。
- 证据：`output/leave-a-light-library-verification.json`、`output/leave-a-light-audio-verification.json`、`output/leave-a-light-reopen-verification.json`、`output/leave-a-light-balance-final.json`、`output/leave-a-light-m4a-retry-ui.json`。
- 窗口实拍：`output/leave-a-light-play-A.png`、`output/leave-a-light-play-A-progress.png`、`output/leave-a-light-play-B.png`、`output/leave-a-light-reopened-play-B.png`、`output/leave-a-light-library-list.png`。

本次交付为本机文件与启动器，没有上传Library或云盘；父会话可直接引用这些本机交付路径。封面仍为明确标注的本地原创占位，尚未实际出图；未对演唱逐行核对、商用权利、正式发行或平台统计作完成声明。没有新账号绑定、凭据导出、Git推送或每日计划变更。
