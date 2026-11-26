# 2026-11-24 RF-019 同计划并发与核对留痕

## 原因与决策

任务中心和计划中心可能同时执行同一个计划，导致重复生成、费用或发布操作。已有 unknown / not_found 核对会覆盖 attempt 状态，并可能让“未查到”被误读为可重试。susu 多次要求“继续”后，本轮按此前逐项说明的推荐默认实现；没有新增超时阈值或自动重发。

## 改动

- `src/core/plan-center/index.ts`：Core transaction 按 planId 统一检查全部来源的 active run；手动、任务中心和定时入口使用同一约束。`ACTIVE_RUN` 错误附带确切 `activeRunId`。
- `src/core/index.ts`、`src/shared/contracts.ts`、`src/renderer/main.tsx`、`src/renderer/pages/PlanCenter.tsx`：经 RPC 保留冲突 run ID；计划中心触发第二次执行时直接打开已存在执行详情。
- `src/core/publication-tasks.ts`：普通任务中心遇到已有执行时将其以 `owned:false` 关联并显示“沿用计划已有执行”；详情入口可查看确切 run，停止任务不会停止该既有 run。定时入口无论预检查或事务仲裁发现冲突，均将计划记入跳过清单，不接管或关联已有 run。
- `src/renderer/pages/PlanCenter.tsx`：`not_found` 不再显示阶段重试按钮，与 Core 的 failed-only 门禁一致。
- `src/core/plan-pule.ts`：修复静态类型检查发现的 recovery evidence 编号读取错误，使用 attempt 已记录的核对次数递增。
- `tests/publication-tasks.test.mjs`：替换过时的跨入口并行预期；增加任务先启动/计划先启动的单活跃断言、定时跳过和启动仲裁竞态覆盖。
- `src/core/plan-center/index.ts`、`src/shared/plan-center.ts`：reconcile 追加 observation，记录结论、证据 ID、来源、操作者、时间和原因；attempt 当前状态字段仍可更新作为最新状态投影。`not_found` 只追加记录、不把 attempt 改写为可重试态；重试入口只接受明确 failed。旧 attempt schema 兼容缺少 observations 的记录。
- `src/core/plan-center-reads.ts`：执行详情回传 renderer 前将 observation 证据 ID 投影成 SHA-256 指纹及末四位；持久化原值不变。计划 Dashboard 活跃项、最新记录和历史包括 `publication_task` 来源，保留原始 source。
- `src/core/plan-center-integration.ts`、`src/core/plan-center-music-stages.ts`、`src/core/provider-plan-text.ts`、`src/core/plan-workflow.ts`、`src/core/plan-pule.ts`：明确自动核对来源为 provider 或 system；恢复查询的 pending / not_found 也追加核对记录。
- `src/shared/plan-center.ts`、`src/core/plan-center/index.ts`、`src/core/plan-center-integration.ts`：新增人工 observation 接口，仅接受 unresolved attempt；由 Core 指定 `user/local-user` 和生成 evidence ID，保存结论与必填核对说明，不改 stage 状态、不自动释放额度、不改变重试资格。该入口不验证外部证据 ID 的真实性或归属，source/actor 字段也不是身份认证。
- `src/renderer/pages/PlanCenter.tsx`、`src/renderer/plan-center.css`：阶段诊断折叠展示追加核对记录的状态、北京时间、来源、脱敏证据末尾、操作者和原因。
- `handoff/2026-11-23-rf019-task-plan-acceptance-checklist.md`：QA 增补跨入口并发、原子仲裁、观测追加和 not_found 重试限制场景。

## 保留的安全边界与影响

- 文本调用 usage unknown 时继续保留额度 reservation，计划工作流不将其当作成功，不推进评分、改写或音乐生成；本轮经源码核实，没有另加重复拦截。
- 没有可用阶段等待分布来制定阈值。现有耗时与更新时间只是本地记录信息，不表示供应商最后检查时间；系统不自动取消、转失败或重发。
- `not_found` 不证明请求从未发出；原 attempt ID 和观察历史保留，`not_found` 不把当前状态改成可重试态。只有明确 failed 状态保留重试能力。
- `activeRunId` 可由计划中心同步启动冲突直接打开。普通任务中心已有执行由 task 关联查看，owned 为 false；不能由 task 停止它。定时任务遇到冲突则跳过该计划并在轮次结果计数。
- 人工入口只记核对说明，不验证用户填写内容是否真实，也不将人工“成功/失败”作为阶段最终结果；阶段仍以供应商/系统回执更新。核对说明可能包含敏感内容，存储在本地记录中。

## 验证

- `node --test tests/publication-tasks.test.mjs` 通过，38 项通过、0 失败；覆盖任务/计划入口冲突、停止归属、定时预检查跳过和事务仲裁竞态。
- `git -c core.whitespace=cr-at-eol diff --check` 通过。`node node_modules/typescript/bin/tsc --noEmit` 已运行；本轮新增的类型问题已修正，剩余阻塞是当前 node_modules 缺少 `reflect-metadata`、`@peculiar/x509`、`qrcode-generator` 三个声明/依赖。
- 未运行完整集成套件、构建、无头 UI 或 Windows 原生验收；未进行真实 API / 平台操作。QA 清单其余跨中心双端与生产边界场景仍待隔离或原生验收。
- 当前仓库存在其他并行未提交修改，最终 diff 检查需用 `git -c core.whitespace=cr-at-eol diff --check` 避免把 CRLF 行尾误判为空格。

## 后续与回退

- 在隔离数据上验证两个入口并发竞争时仅创建一个 run，第二入口打开正确 run；验证重复 requestId 幂等、owned=false 停止边界、定时竞态跳过、旧 attempt 无 observations、reconcile 追加、not_found UI/Core 均不可重试以及来源和证据脱敏。
- 隔离验收人工记录不会更改阶段状态/重试资格、空说明不能提交、用户记录追加且时间/来源稳定、renderer 不接收原始 evidence ID。
- 回退时仅撤销本轮 E-H 实现和索引更新；保留 A-D 的派发边界、余额分类与异常提示，不覆盖同一文件里的其他工作区修改。
