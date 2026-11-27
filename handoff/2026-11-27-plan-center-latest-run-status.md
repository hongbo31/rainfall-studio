# 计划中心首页执行状态同步

## 用户现象

计划详情中最新第 94 次执行显示“本次已完成”，计划中心首页却显示“已阻塞”。

## 原因

详情记录按执行创建时间显示最近一次执行。首页同时返回 `latest` 和 `active`，列表原来优先显示 `active`。`planRunActive` 会把历史 `blocked` 记录视为活跃，即使该阻塞记录已没有未结的阶段、发布或专辑工作；因此第 92 次旧阻塞状态可以盖过第 94 次成功状态。

## 修改

- `src/core/plan-center-reads.ts`：首页仅把仍有未结工作、按既有规则会阻止删除/新执行的 run 作为 `active`，并复用同一判定设置删除锁。
- `src/renderer/pages/PlanCenter.tsx`：执行结果优先显示按创建时间排序的最新 run；活跃 run 仍用于停止等操作。
- `handoff/PROJECT-HANDOFF.md`：登记问题、根因和验证范围。

## 验证与限制

- 静态复核了首页与详情的数据路径；按仓库 CRLF 行尾设置执行 `git -c core.whitespace=cr-at-eol diff --check` 通过。
- 按后台开发要求未运行测试、类型检查、构建或客户端验收。修改尚未进入桌面客户端。
- 已有执行记录不会被改写；列表重新读取后应显示最新执行结果。若最新 run 本身仍是 `blocked`，仍会如实显示阻塞状态。

## 回退

仅回退 `readPlanDashboard` 对 `active` 的判定及计划列表 `latest` 的选择，并保留同文件中的其他工作区改动。
