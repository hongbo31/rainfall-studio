# Durable Production Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在现有Windows客户端实现完整持久流程：定时触发→候选→评分与最多两次修订→作品→音乐任务→素材→待发布任务→真实执行器回执，默认停在候选与待发布。

**Architecture:** 保留0.6.0-nightly.1可靠桌面包和原库。新增独立生产流程服务，Core负责计划、阶段、版本、预算预留和幂等记录；Main负责凭据和外部端口，renderer只能明确配置与授权，不能伪造stage result。真实网络操作先claim落盘，后record；重启或未知结果不会自动重发。阶段失败按run隔离。

**Tech Stack:** 已安装Electron44、TypeScript、React、SQLite、luxon、zod、Playwright；不安装依赖。

**Spec:** 用户2026-10-16最新执行要求：本机每日先自动生成候选；有预算和授权才进入收费与投稿；腾讯A新三年条款仍待确认；dot只如实说明人工导入，不声称自动唤起dot。

## Global Constraints

- 不真实调用新的收费生成，不正式提交A，不接受新条款，直到取得明确授权。
- 默认本地候选标记local_template，默认本地检查标记rule_based；不伪称DeepSeek联调或模型评分。
- 文本预算为USD微元估算，音乐预算为provider credits，不能混用fixture ledger或伪造零费用。
- 默认只候选/待发布；真实发布需每首作品、账号、录音及条款范围的明确授权。
- 保留作品、素材、配置、旧可靠运行包与回退备份，不推远端。

## Review Focus

1. 相同计划时点、重复点击和重启：唯一run与operation，不重复扣费或投稿。
2. 调度漏跑、时区/DST、倒退时钟：有界跳过/补跑，不意外补发多次收费请求。
3. HTTP超时、未知结果与模型错配：保留预留和原任务，不自动重发；只读查询恢复已知任务。
4. 一个任务失败或凭据缺失：阻塞该run/账号，不拖住其他无关本地候选。
5. 发布权限、登录、协议、控件或唯一身份缺失：执行器返回具体阻塞，观察证据不冒充执行回执。

## Task 1 — Core持久阶段与调度

**Files:** 新增`src/shared/production-flow.ts`、`src/core/production-flow.ts`及必要独立辅助文件；新离线专项测试/runner。

**Interfaces:** 严格计划schema；service提供savePlan/enable/disable/trigger/tick/list/context/next/claim/record/approve/retry。所有外部结果record只能经Core internal通道。跨阶段保留run、candidate revision、score、work、music operation、asset及publication ID与hash。

- [x] 写并运行失败测试：production定时本地候选、重复时点/点击、有限评分修订、unknown重启、每run失败隔离。
- [x] 实现独立账本和阶段CAS、候选默认停止、收费/发布授权门槛。
- [x] 完成work/materialize回调，拒绝把缺失音频/封面当成功。
- [x] 离线真实service E2E跑至publication receipt，测试重启和重复派发不增加副作用。

## Task 2 — 真实评分与音乐/投稿端口

**Files:** `src/shared/text-evaluation.ts`、`src/core/workflow/deepseek.ts`；Main生产流程broker和发布执行器桥。

**Interfaces:** DeepSeek evaluate返回实际模型/request/usage与评分维度；总分本地按0.4歌词+0.3曲风+0.3一致性计算，阈值可配置。音乐复用YourMusicAdapter，接受返回但费用未知时保留预算，查询/下载只针对原song IDs和已核实URL。投稿端口只调用正式executor capability/preflight，不返回观察记录当receipt。

- [x] TDD实现评分JSON、错revision/模型、无效评分、已知usage计费、unknown与低分反馈。
- [x] Main固定凭据作用域、预算及profile revision，调用前持久claim，结果后internal record。
- [x] 用离线端口覆盖整链成功、低分有界修订、音乐下载重试不重生成、投稿unknown不重投。
- [x] 对真实腾讯端口给出唯一账号、AI路由、协议或控件的具体能力结果，不通过UI输入字符串解除安全门槛。

## Task 3 — UI接线与默认模式

**Files:** 新生产流程面板；ChatCreation接线；Main/preload/contract/Studio tick和RPC小范围接线。

- [x] 计划可配置时区/时间、启停、本地候选与获准文本模式；预算和授权默认空/关闭。
- [x] 阶段图、历史、评分来源/重试数、预算预留、失败与unknown、作品/素材/发布任务与回执可见。
- [x] 缺Key只阻塞真实端口，不阻塞本地候选与配置；dot人工导入入口不宣称已连接外部发送端。
- [x] 对每首发布授权、待审核/已上线、可恢复下载与不可重发unknown提供明确操作。

## Task 4 — 独立复核、打包与同入口验收

- [x] 独立审查预算、阶段CAS、模型评分、任务隔离、调度、重启和发布去重，修复实质问题。
- [x] 跑完整Core/新专项/类型检查/构建及隔离GUI E2E；网络夹具和真实验证分别记录。
- [x] 新完整便携候选通过后才更新同一桌面入口，复用原dataRoot；验证重开、原媒体SHA和当前待授权状态。
- [x] 交付实际版本、截图、验收清单与具体不可获得能力证据，不能把计划或dryrun称整链已实发。

本计划直接执行，依据用户明确“继续完成、缺Key不阻塞实现”的授权；不再次请求普通实现批准。新增法律接受或未知费用仍须按范围停在对应阶段。
