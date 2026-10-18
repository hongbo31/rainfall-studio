# Simple Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 简化发布操作并集中平台配置，保留旧库和法律/能力边界。
**Architecture:** 复用现有Studio/SQLite settings、Main RPC验证和React工作台；新增版本化平台配置与本地发布检查请求，旧执行器移入诊断页。
**Tech Stack:** 已安装Electron44/React19/TypeScript/SQLite，零安装。
**Spec:** `docs/superpowers/specs/2026-10-17-simple-publishing-design.md`

## Global Constraints

- 原生崩溃防护不移除；schema3、原dataRoot和同桌面入口保持。
- 不新增收费、不接受三年条款、不进行腾讯提交或对外发布。
- 不清除/读取凭据；旧作品、账号、素材和历史不覆写。

## Review Focus

- 多账号歧义不可默选，跨平台引用不可保存。
- 默认资料不能变成法律同意或伪造授权。
- 返回配置页与重启不丢选择，恢复任务不自动执行。
- 双击/排序变化不能重复创建请求；旧未知结果不得重试。
- 旧设置/原曲/素材和本地原生诊断保持。

## Task 1: Core configuration and local publication checks

Files: `src/shared/platform-config.ts`, `src/core/platform-config.ts`, `src/core/simple-publication.ts`, Studio/schema wiring and integration tests.

- [x] 写迁移、CAS、跨平台、协议字段拒绝与发布检查的失败测试并确认RED。
- [x] 实现spec的精确接口与幂等版本化记录；冻结材料，不接远端传输。
- [x] 检查两次迁移、两次点击、重启、旧行/素材/凭据内容不改，测试GREEN。

## Task 2: Configuration center

Files: `src/renderer/pages/ConfigurationCenter.tsx`, `PlatformConfigurationPanel.tsx`, existing Accounts optional API display and focused styles/tests.

- [x] 写分类、默认表单与法律边界测试，确认RED。
- [x] 五个平台分开保存；保留模型API、旧管理与移入的诊断页面。初始target由props传入。
- [x] 配置保存和缺项提示无重复弹窗，测试GREEN。

## Task 3: Simple publishing UI

Files: `PublishCenter.tsx`, `PublicationDiagnostics.tsx`, `QuickPublish.tsx` or replacement, `main.tsx`, focused styles/UI tests.

- [x] 写主页面信息量、空选/多选、状态文案与无直接第三方调用测试，确认RED。
- [x] 三步选择和持久草稿；链接到对应平台配置；简洁任务与条款卡，详情折叠。
- [x] 保留旧发布工具到诊断页，默认不加载；验证状态恢复与防重复。

## Task 4: Review and desktop delivery

- [x] 独立review并修正重要问题，运行构建、类型和回归。
- [x] 一致性备份后在隔离Electron实际验证多选、配置往返、重启、原A试听与原生事件。
- [x] 打包0.8.0-preview.1，更新同一桌面入口，复用原库；连续重开无新异常。
- [x] 上传发布中心/配置中心截图到Library，记录真实路径、包/源码和剩余接入限制。


实际交付和限制见 docs/release/simple-publishing-0.8.0.md。最新不弹窗指令到达后停止可见操作；已完成3次启动/退出，第4次不再自动打开，当前客户端未运行。
