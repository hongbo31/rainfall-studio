# 2026-10-16 晚间工作流增量

版本 `0.6.0-nightly.1`，仅本机交付，不推远端。桌面入口继续使用 `Rainfall Studio 音乐客户端.lnk` 和权威 `verified-desktop.json`，复用原 dataRoot。此版本不代表全自动生成及上架已经打通。

## 真实发布准备

已在 SOURCE_WINDOWS_HOST 的正常 Chrome 会话核验已发布列表仍为原有两首，未发布专辑与歌曲列表为空。重新打开已失效的未保存页面后，只恢复《示例作品A》A；PCM兼容音源被识别为03:30，无解码错误。封面为既有3000像素无字放大派生，不是原生3000；音源由原A解码为PCM24，不是原生无损母带，音质没有提升。

词曲均为用户确认的“云端测试艺人”，允许翻唱，申报AI、不走签约结算。通过实际日历选中2026-10-16，日期必填错误消失，全部资料通过校验。已到达 [官方AI页](https://y.tencentmusic.com/#/user/manage/aiChoose/add) 的授权模式：**非独家授权3年，期间歌曲不可独家授权其他平台**。该新条款等待用户明确确认，尚未点击提交审核、没有歌曲/提交ID，不得称已上架。创作证明是选填；未伪造授权证明。

证据：`output/tme-ai-A-authorization-preview-1813.json`、`output/tme-observation/leave-a-light-A-authorization-preview-1813.png`、`output/leave-a-light-A-ai-phase-status.json`。证据记录已通过新观察服务保存为 `prepared / user_report / submissionByClient:false / remoteId:null`，保留原A与PCM SHA派生关系。没有借账户昵称把本地备注标成已授权或唯一腾讯主体。

## 本次产品变化

- 新增独立DeepSeek官方HTTP适配器和Main凭据桥，采用JSON结构返回歌词与曲风；固定官方主机和路径、DNS公网地址校验、无跳转、响应大小和超时限制。Key只在Main消费，不返给renderer。
- 逐轮显式准备任务、模型、输出上限、预算（美元）及最多两次改写；准备不生成，运行须再明确点击。每次请求前持久化操作、CAS版本和预算预留。未知结果保留预留、冻结配置；无效JSON、截断、锁定句冲突仍记录已返回usage，不虚构零费用。
- 估费依据2026-10-16 [官方价目表](https://api-docs.deepseek.com/quick_start/pricing/)，按峰值cache-miss价格保守估算，不是账单。返回模型与已核实官方映射不符时，保留真实模型和usage、估费置未知、冻结，不按便宜请求模型释放预算。
- dot本地导入内容可人工选入音乐输入，保留来源、版本、pair/hash；仍未评分，不自动标为通过。普通音乐候选的下载失败重试恢复原单，不新增生成提交。
- 新增官方页面观察记录，允许没有远端ID，分别记录资料准备、提交、审核、发行、驳回等状态，证据SHA全局去重；不把观察变成客户端投稿。恢复旧备份不得擦除新增观察。
- 修复编号Chorus/Pre-Chorus结构标签清理。默认integration runner现在自行构建所需workflow bundle，不再依赖外部环境变量才能运行。

## 已验证与尚未完成

后台核心174/174、DeepSeek核心18/18、Main及界面边界12/12、基础3/3、类型检查和构建通过。可见GUI使用原库一致性副本、原媒体副本及明确离线传输夹具；实际测试结果与截图以 `output/nightly-gui-verification.json` 为准，不是DeepSeek真实服务成功证据。真实原A本地播放、腾讯PCM解码及表单校验分别有现场证据。

当前真实库只有既有谱乐音乐配置，无DeepSeek Key。本次仅新增无Key、未验证的DeepSeek元数据配置和未连接的腾讯观察备注；没有创建凭据、改变原艺人名、删除原作品或替换原A/B/封面。备份位于 `output/nightly-backup.json` 指向的目录，不含credentials。

仍未完成的产品能力：生产定时自动候选、真实模型评分及评分不合格自动再生成、通用音乐收费预算、多账号唯一身份下的客户端自动投稿。日程目前仍是草稿/预览；不能把“只准备”或离线回归称为全自动已打通。Codex/Claude仅配置槽位；dot只有本地收件端，不能声称发送端已连接。封面仍是人工Codex协作及导入，不存在免费Codex图像API。

真实服务验收还依赖用户私下配置DeepSeek Key及明确预算、腾讯新条款确认、合法可靠的唯一账号/AI表单提交接入。新增音乐生成或供应商WAV收费均未调用，本轮费用0。腾讯自动写入门禁没有因一次网页操作而解除。

## 明日验收

1. 双击同一个桌面入口，确认显示版本0.6.0-nightly.1；重复打开应复用同一窗口。
2. 作品库打开《示例作品A》，核对原A/B、两版封面及真实A播放；原库仍1首真实作品，隔离演练仍3首示例。
3. 创作页核对DeepSeek配置无Key提示；私下填Key后可只读检查模型列表，明确输入单轮预算才准备和运行文本任务。查看真实provider ID、usage及估费；未知结果不得重发。模型评分未完成的候选不能冒充自动过审。
4. 发布中心展开“腾讯官方页面进度与证据”，应显示本曲资料已准备、三年条款待确认、远端ID为空，不显示已上架。若用户确认条款，继续同一官方页面，正式提交后另核对ID和审核状态。
5. 重启客户端，确认作品、素材、配置、文本任务及观察记录仍在。日程默认禁用、生产自动投稿阻塞应如实可见，不把它们算作通过项。

## 实际桌面交付结果

已交付源码 `c4b14749e7ef3cd275abfa091b1f4774c10c4803` 的完整便携包：`C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp\out\nightly-workflow-c4b14749e7ef-1792176411647\RainfallStudioCandidate.exe`。实际同一桌面快捷方式已更新，版本显示0.6.0-nightly.1；首次主进程37364，重复入口复用该窗口，正常关闭后从同一入口重开为24240。没有安装新软件。

权威数据根仍为 `C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp\out\tme-readiness-f98b20328ab4-1792145753240\candidate-data`，不能清理。原1首真实作品、4个素材（A/B及两版封面）的完整数据库行与升级前一致，文件SHA全部核验；3首演练示例仍在。原音乐任务操作行未变化，真实库没有新增live_text操作。现场截图显示A播放到0:22/3:30；Windows UIA ValuePattern回读停在0:00，是该控件的过期值，因此播放推进证据采用原始截图，不将该UIA值误当成未播放或伪造数值。

打包版8项GUI流程与实际重启通过，0渲染错误；3次模型传输均为QA进程明确拦截的离线夹具，真实请求0。最终后台回归核心174/174、文本18/18、收件33/33、腾讯live30/30、边界/SSR12/12、基础3/3。测试工具曾遇到Electron评估上下文没有require、以及定位器选中隐藏option，均只修正测试工具后重跑通过；没有通过削弱未知冻结、费用或投稿保护来让测试通过。

最终证据 `output/nightly-desktop-final-verification.json`、`nightly-final-data-verification.json`、`nightly-desktop-repeat-verification.json`、`nightly-gui-verification.json`。实际窗口截图：`output/nightly-desktop-A-progress.png`、`nightly-desktop-delivered-observation.png`、`nightly-desktop-creation-ready.png`。回退备份 `output/nightly-desktop-backup-1792175891638` 包含升级前验证指针、同一快捷方式、SQLite一致性快照和素材，不含凭据。恢复旧指针/快捷方式可回退运行包；继续使用原数据根，不能删除新记录或新包。

最后只读核验腾讯仍停在三年授权模式页，未接受、未提交。**本次交付完成的是明确列出的本地增量及验证，不是“全自动创作到上架”验收通过。** 生产定时生成、模型评分/低分重试、通用音乐预算和客户端自动投稿仍有实现/接入缺口；DeepSeek真实联调还缺Key和明确预算。法律确认不能替代这些工程与凭据条件。
