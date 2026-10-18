# 0.7.1 北京时间与腾讯 AI 准备执行器

设备：SOURCE_WINDOWS_HOST。独立项目：`C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp`。本轮没有安装软件、推送远端、新建凭据、追加收费音乐生成或 DeepSeek 调用。保留原桌面入口、数据根与回滚包。

## 北京时间

原计划 `160b098d-84a3-465c-ba6f-a4598fd71c94` 已通过真实 Core 从 `Etc/UTC 09:00` 修正为 `Asia/Shanghai 09:00`，即 `01:00 UTC`。计划 revision/authorizationRevision 从 1 升为 2，仍是本地模板与规则检查，text/music/publication 均为空，不扩大收费范围。下一次实际计划时间为 `2026-10-17T01:00:00Z`，北京时间 10 月 17 日 09:00。

修正前一致性备份：`output/beijing-tme-ai-desktop-backup-1792180580722`。真实修正脚本及报告：`output/beijing-plan-repair-20261016/`。再次执行修正 `changed:false`；保护哈希相同，旧候选、作品、原始 A/B、账号备注和 API 配置保留。界面同时显示北京时间、UTC 偏移、UTC 对照与下一次日期。程序退出、关机或睡眠时不执行，不补扣费。

## 腾讯准备流程

发布中心新增独立的“腾讯 AI 作品 · 真实页面准备”：选择已授权作品 → 核对当前官方绑定信息与浏览器窗口 → 登记 A 范围 → 持久操作日志 → 核对/上传 A、歌词、作者、工具、日期和允许翻唱 → 本地封面选择与裁剪 → 本地专辑材料快照 → 下一步官方预检 → 新条款待确认。

官方可见资料中的酷狗绑定 ID、关联酷狗音乐推 ID 一致，并与 QQ 显示名、艺名共同形成绑定指纹。它不是腾讯 UID、OAuth 授权或通用账号登录凭据；本地账号仍不被改成 OAuth 已连接。每次执行重新读取官方页面，绑定浏览器 PID、启动时间、窗口与文档 RuntimeId。公开界面仅显示掩码 ID，不接受网页传入身份、文件路径或完成回执。

当前原生运行条件：Windows、已安装 PowerShell 7.6、同一已登录 Chrome/Edge 的官方 AI 作品页，以及官方资料编辑页中“绑定其他平台账号”标签。此次已保留这些页面；关闭、换号、改作品或改变窗口会安全停止，需重新核对。客户端不自动登录，不绑定新账号，不处理验证码。本轮真实验证是现有已授权 A 的恢复准备链；空白表单从零上传、批量作品及全平台无人值守未宣称已真实联调。

用户批准范围仅《示例作品A》A；B 不进入上传。原 A 不改写。上传兼容件是 PCM24 WAV，源为原 A，非原生无损母带；本地哈希核对和已观察的文件选择只证明本地材料及选择关联，不代表平台提供了可验证的远端字节哈希。原歌词保留，投稿使用去结构标签的 647 字版本；署名为云端测试艺人，允许翻唱，工具为谱乐 AI API / chirp-v6，生成日期为 2026-10-16。

封面仅采用已批准的本地 3000px 放大派生图，不点“重新生成”。原生选择器校验真实地址、完整文件名、窗口 owner 与浏览器进程；裁剪仅操作“调整图片”分组内的确认，随后读取“更换图片 / 智能封面”状态，并确认原智能生成提示消失。没有免费 Codex 图像 API 声称。

## 中断与证据

每个可能改变官方页面的动作先写 Core operation。默认不重发 unknown；重启冻结在途操作。相同作品/原 A/绑定身份不能换授权或更换 PCM 绕过去重。恢复备份不得抹掉准备记录，并悬挂旧授权。

真实验收发现文件名控件为 Pane、裁剪框为 Group，以及空名称控件和“提交审核”按钮标签差异。保留原失败记录后，使用原选择器一次续接、原裁剪一次续接和只读核对收敛，没有重新打开上传或重复确认。原选择阶段关联恢复明确标为 `phase_contract_reconstruction`，不是捏造的历史返回回执，也不是远端字节验证。

可选官网“保存”的结果保留为 unknown，不再重试，也不记录成保存成功。后续 `save_album` 是兼容日志阶段名，仅核对并留存本地材料快照；`remoteAlbumSaveVerified:false`。本地快照不代表官网保存、正式投稿、审核或上架回执。官方下一步预检与条款终点独立读取。

所有准备路径都没有 accept、agree、签约或正式 submit 动作。新条款为“非独家授权；授权 3 年，期间歌曲不可独家授权其他平台”。用户尚未确认，客户端只能停在待条款确认。远端歌曲/投稿 ID 仍为空。

## 能力状态

| 能力 | 本次状态 |
|---|---|
| 北京时间本地候选 | 已修正真实计划；模板/规则标注清楚，非真实 AI 调用 |
| 腾讯 AI 当前授权 A 准备 | 原生 UIA 实际验证；终点只读等待新条款 |
| DeepSeek | 缺用户 Key；本轮没有真实调用 |
| 谱乐 | 复用既有一次付费结果；本轮追加收费生成 0 |
| 腾讯正式投稿/签约 | 未执行，客户端没有本流程的接受或提交动作 |
| 其他发布平台、通用无人值守投稿 | 未开放 |
| 封面 | 本地批准文件；Codex 辅助导出/导入，不自动调用图像 API |

## 验收与交付证据

最终源码包：`9f86474f1121b52be7138d519fbc2d15977b6ce7`，版本 `0.7.1-preview.1`。可执行文件：`out/beijing-tme-ai-9f86474f1121-1792182260153/RainfallStudioCandidate.exe`。保留完整目录。用户正常入口仍为 `C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk`；启动器和权威指针仍位于 `%LOCALAPPDATA%/RainfallStudioLauncher/`。

实际运行数据根保持 `out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`，它是持久库，不能作为测试输出清理。更新前回滚快照为 `output/beijing-tme-ai-delivery-backup-1792182057727`，保留 0.7 程序、旧桌面指针和完整数据，不复制凭据。

桌面实际 PID 从 18260 重启为 34176，仍为同一数据根、同一准备任务 revision20。原 A 实际播放到 `0:01 / 3:30` 后暂停；原始 1 个作品、4 个素材及全部原始 A/B/封面 SHA 未变，隔离模拟库仍为 3 个作品。原每日候选仍只有 1 轮，无重启补跑。官网可选保存操作仍是原 unknown；封面、条款误判的原记录完整保留在只读核对链中。

真实 Core/Main/UIA 任务 `189cb602-32a9-4bc5-99d7-54d800e8c11f` 已读回三年非独家条款并停在 `awaiting_terms_review`，远端歌曲/投稿 ID 为空。重复 terminal run 不再创建原生动作。正式提交、接受条款、新收费音乐生成、DeepSeek 实际调用均为 0。

验证：Core 174/174；生产调度 24/24；时区 UI 4/4；腾讯准备 Core/文件/恢复集成 29/29；Main broker 16/16；准备 UI 8/8；整体流程/恢复夹具 2/2；工作流 38/38；原真实文本通道 18/18；文本评分 12/12；原腾讯链 30/30；基础 3/3；typecheck、构建及差异检查通过。独立最终包 GUI 两组 10+6 项均通过，renderer 错误/HTTP/原生输入为 0。真实原生准备与离线 GUI 证据分别记录；离线成功不冒充真实平台完成。

主要报告：

- `output/beijing-tme-ai-package.json`：最终便携包与验收状态。
- `output/beijing-tme-ai-flow-gui-verification.json`、`output/beijing-tme-ai-gui-verification.json`：隔离桌面包主流程、时区与实际终点记录。
- `output/beijing-tme-ai-final-data-verification.json`：真实数据保留、费用操作、重启与准备去重核对。
- `output/tme-ai-live-reconcile.json`：真实 Core/Main/UIA 条款终点；`output/tme-ai-terms-fresh-endpoint.json` 为独立原生读回。
- `output/beijing-tme-ai-desktop-schedule.png`、`output/beijing-tme-ai-desktop-terms.png`、`output/beijing-tme-ai-desktop-restarted-terms.png`：原桌面入口实际窗口。
- `output/tme-observation/tme-ai-executor-terms-endpoint.png`：腾讯官方条款页，未接受、未提交。

最初一次非桌面权限隔离 GUI 启动未建立可见窗口；停止该测试主进程后，在本机桌面权限下重跑通过。一次诊断读取也被自动审批误判为输入并拒绝，后改用明确只读的 UIA/Win32 检查完成；无遗留审批阻塞。以上失败没有用通过回执覆盖，生产指针在最终包验收后才更新。
