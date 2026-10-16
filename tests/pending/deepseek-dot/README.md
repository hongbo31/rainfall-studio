# 离线开发单元测试（用户验收待执行）

最终更新：28 个新用例加 13 个既有配置/凭据单元回归，41/41 通过。一次独立审查的两项回执/扫描缺陷已先失败后修复。此处“pending”仅是保留目录名称，用户验收待执行；不是这些开发单元测试未运行。最新证据与范围见 docs/release/deepseek-dot-development.md。

更新：父会话澄清开发离线单元测试允许执行后，已按 TDD 运行此目录用例，现为 26 个新用例。目录名称保留以免既有 integration 发现器误执行；专用命令 `node scripts/test-inbox-unit.mjs --regression` 只编译测试用模块、运行这些用例及 13 个配置/凭据单元回归，结果 39/39。子进程在加载应用模块之前阻断网络和再派生进程。所有库/文件均为 output/test-runs 隔离假数据，UI 仅服务端静态渲染；没有窗口、实际收件箱投递或真实密钥。本次结果属于开发单元测试，用户验收仍暂停。

下文为原草案状态，仅保留历史。具体最新证据见 docs/release/deepseek-dot-development.md。

此目录包含 13 个测试草案：inbox.test.cjs 9 个，text-provider-config.test.cjs 4 个。它们针对计划接口而写，生产实现和 bundle 尚不存在，**未执行、未观察失败，也未通过**。

现有 scripts/test-headless.mjs 和 scripts/test-workflow.mjs 仅发现 tests/integration 下的测试，因此不会误执行本目录。不得为了得到绿色结果添加 test.skip、假实现或用旧 bundle 代替。

待父会话明确批准 TDD 例外或用户恢复测试后，按 docs/superpowers/plans/2026-10-15-deepseek-dot-inbox.md 继续。恢复测试时需创建新的正常 Node bundle：

- RAINFALL_INBOX_BUNDLE：src/core/inbox/index.ts，导出 InboxService、InboxReceiver、Repository。
- RAINFALL_TEXT_CONFIG_BUNDLE：src/shared/text-providers.ts，导出 parseTextProviderProfile、textProviderReadiness。

未来命令为 `node --test tests/pending/deepseek-dot/*.test.cjs`，前提是上述新 bundle 已编译并设置环境变量。此处只是后续操作说明，本轮不得执行。端点测试不联网；收件测试只会在未来执行时创建 output/test-runs/inbox-* 临时测试库，不读取真实用户数据。

现有草案还不覆盖 Windows 重解析点/链接权限、回执写失败重启、备份恢复和窗口模式切换的全部竞态。实施 Task 2–4 必须补齐这些测试，不能将当前 13 个草案称为完整验收。
