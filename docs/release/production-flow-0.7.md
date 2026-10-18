# 0.7 持久生产流程

本机项目：`C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp`，设备 `SOURCE_WINDOWS_HOST`，版本 `0.7.0-preview.1`。独立 Electron/React/TypeScript/SQLite 项目；本轮不安装软件、不推远端，不增加真实生成扣费，不投稿、不接受新协议。

## 交互与范围

AI 聊天创作页上方的“每日候选与生产流水线”可保存故事、艺人、当地时间和 IANA 时区。默认本地模板/规则检查，保存后停用；可手动触发或明确启用每日时间。每计划每天最多一轮，不因随机更换点击请求号绕过上限。每个新改写版本均重新确认，不拿初稿确认替代新版本审批。

完整阶段：调度 → 候选 → 评分/最多两次改写 → 作品 → 音乐任务 → 原始素材 → 待发布 → 执行器回执。Core 持久记录轮次、版本、操作与预算；Main 持有凭据并执行外部端口；Renderer 只能发起严格范围动作，不能注入收费、未发送证明或官方回执。

Core 在应用运行时每秒检查日程；关机、睡眠、注销和退出期间不运行，超过90秒的漏跑跳过，不补扣费。不注册开机启动、系统任务或云任务。停用计划仅停止未来轮次；托盘“暂停自动创作”停止日程和当前待执行阶段，已发出的请求保存原结果后保持暂停。

DeepSeek生成和评分分别调用。评分校验 revision、模型、原文引文和 usage；歌词40%/风格30%/一致性30%，默认阈值75。模型评分标为未经人工校准，规则检查明确非模型评分。低分改写最多两次，无效评分仅有界重试评分，全部共享本轮文本预算。

文本采用 USD 微元保守预留/估算，音乐用供应商 credits，分开记账。缺Key在claim前阻塞，不预留或伪称调用成功。claim后结果未知保留预留，冻结同配置新收费；重启和重复点击不重发。音乐accepted但费用未知仍保留预留，可按原歌曲ID查询/下载。只读中断可恢复原ID；轮询15–60秒退避、120次及24小时上限。

未提交音乐的轮次可明确“改用官方生成后导入”，只改变本轮，保留原计划和切换记录；已有音乐提交、预留、已花费或未知结果时拒绝切换。没有音频时试听禁用。发布材料还需真实音频/封面文件及SHA、歌词/音频对应确认和完整腾讯预检；作者、AI或权利信息有问题都不能标记材料齐备。正式投稿另需逐首、账号、录音、封面、歌词及条款hash授权。

恢复备份不能抹除新增轮次/原单身份；恢复后的计划停用，未完成轮次旧授权失效，不会静默复用收费许可。凭据不进入归档。

## 能力矩阵与阻塞

| 部分 | 工程状态 | 当前真实能力 |
|---|---|---|
| 本机每日候选 | 持久启停、防同日重复 | 本地原创模板可执行，需应用运行 |
| DeepSeek生成/评分 | 官方固定端点、预算、评分/改写/未知处理已实现 | 当前交付库无Key，未真实调用；本轮仅离线传输与GUI验证 |
| 谱乐音乐 | 生成、原ID查询、白名单下载、A/B入库适配器 | 保留原《示例作品A》一次明确授权请求；通用自动收费缺已验证单次价格上界，拒绝新收费，历史5credits不是固定费率 |
| Suno | 配置/材料路径 | API合同、价格及用户权限未验证；无网页机器人或免费号池 |
| 封面 | 提示词、Codex任务导出、图片/清单导入、版本、排版 | 人工文件交接；无免费Codex图像API，不自动唤起dot |
| 腾讯音乐 | 材料预检、观察记录、真实执行器能力门禁 | 唯一账号身份与AI投稿页面写入契约未验证，新协议未授权，阻止自动上传/投稿 |
| 网易云/汽水/QQ/酷狗 | 各平台材料包/预览 | 公开发行API及权限未核验，不承诺无人值守全平台 |
| 抖音 | 视频材料，区分音频发行 | 发布/数据权限未申请，无自动视频投稿 |
| 统计 | CSV导入、来源/日期、缺失值 | 无在线统计接入，缺失值显示“—” |

腾讯《示例作品A》A仅资料准备，无远端提交ID，正式提交0次。官网出现“非独家、3年、期间不可独家授权其他平台”新条件，待用户确认。B未上传。原音频不声称原生无损；PCM24是格式兼容派生，3000封面为放大派生。官网观察不能当客户端执行回执。

## 启动、验收与证据

正常使用 `C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk`，实际版本/包/dataRoot以 `%LOCALAPPDATA%\RainfallStudioLauncher\verified-desktop.json` 为准。保留0.6可靠包与回退备份，新版通过包内GUI验收后才更新同一入口。不要把新包默认空库当原作品库。

源码开发只使用已安装依赖：

```powershell
npm run desktop:build
$env:RAINFALL_DATA_ROOT = Join-Path (Get-Location) 'output/dev-production-flow'
$env:RAINFALL_MODE = 'production'
npm run desktop:dev
```

检查：`npm run typecheck`、`npm run test:integration`、`node scripts/test-production-flow.mjs`、`node scripts/test-production-flow-e2e.mjs`、`node scripts/test-text-evaluation.mjs`、`node --test tests/production-flow-broker.test.mjs`、`node scripts/test-live-text.mjs`、`npm test`。便携包：`node scripts/package-tme-candidate.mjs --production-flow`；完整目录须保留，不能单独复制EXE。

独立review的手动素材路径、准确错误码等finding已闭环，无剩余Important。完整离线E2E经过实际Core/SQLite/Main broker/适配器/ffprobe/素材/授权/回执与重启；回执为隔离夹具，真实HTTP、真实收费、真实投稿均为0。GUI用复制库，原作品和素材身份/哈希前后比较。

可复核证据：`output/production-flow-offline-e2e.json`、`output/production-flow-gui-verification.json`（含截图路径）；最终包/桌面/dataRoot与数据保留以 `output/production-flow-desktop-upgrade-invocation.json`、`output/production-flow-desktop-final-verification.json` 为准。实际验收结论以生成证据为准，不以计划替代结果。

## 已完成的本机交付（2026-10-16 19:31 UTC）

- 编译源码提交：`e84ba08dfbfc80d3ac0ad15eba56d29fc1d97a9d`，独立分支 `feature/tme-uia-batch`，未推送。
- 完整包：`out/production-flow-e84ba08dfbfc-1792178781176/RainfallStudioCandidate.exe`；原桌面 `.lnk` 已切换此包，并实际关闭重开。PID由26112变为47088；重复点击复用窗口。
- 原dataRoot：`out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。原作品1首、4份素材、账号/配置/操作及3首演练作品均逐行一致，4份素材SHA校验通过，无新增收费或发布操作。
- 已设置“每日关系故事候选”：`09:00 Etc/UTC`、每日最多1轮、本地模板/规则检查、text/music/publication均为空授权。首轮 `533a31c8-20ff-4c6a-93a2-366f0d1008df` 停在待确认，未创建新作品或音频。下次到期在2026-10-17 09:00 UTC；应用须运行。
- 回退备份：`output/production-flow-desktop-backup-1792178749165`，保留0.6程序包、原指针和快捷方式、一致SQLite快照及素材；未复制凭据。
- 最终回归：Core174/174、生产引擎21/21、评分12/12、完整流程/恢复2/2、原DeepSeek18/18、桥接/SSR31/31、inbox33/33、TME30/30、基础3/3、类型检查与构建通过。完整包GUI10项通过、0渲染错误、0真实HTTP；实际交付窗口完成原A音频播放、封面、计划与重启验收。
- 实际截图：`output/production-flow-desktop-restarted-candidate.png`、`output/production-flow-desktop-original-A-paused.png`（播放器0:01/3:30）。腾讯授权预览只读复核仍是AI页面/非独家3年/提交审核按钮，正式提交0次。

真实阻塞没有被测试夹具消除：用户DeepSeek Key缺失；谱乐通用自动收费价格上界未核验；腾讯唯一身份和AI写入页面契约未验证；A新三年条款待确认。工程链与本机候选已交付，不能称真实全自动生成发行已联通。
