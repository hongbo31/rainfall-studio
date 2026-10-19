# 统一计划中心 0.9.0-preview.1

本轮交付独立 Windows 便携预览包、统一计划状态机和可操作界面。源项目位于 `C:\Users\31559\Documents\Codex\2026-10-15\task\rainfall-studio-unified-acceptance-20261018`，执行主机为 DESKTOP-90VCPDC。未安装软件、推送远端、替换正式快捷方式或修改原作品库、凭据及父会话的 dot 自动化。

## 方案与实现

- [技术设计与验收矩阵](../superpowers/specs/2026-10-19-unified-plan-center.md)
- [实施计划](../superpowers/plans/2026-10-19-unified-plan-center.md)
- [原始产品需求](../requirements.md)、[界面设计](../design.md)

计划中心统一配置北京时间的每日、每周和单次计划；执行数量代表独立歌曲主题，A/B 属于同一主题的音频版本。手动立即执行在应用内确认数量、通道、发布选择和每个账号的专辑意图，不占用定时执行次数。停止只作用于本次执行，未来计划保持原启用状态。

SQLite 持久化 Plan、Run、Item、StageAttempt、PublishAttempt、Occurrence 和 AlbumBinding。执行使用不可变配置快照、事务锁与稳定幂等标识；成功阶段不重复生成，未知结果先核对，多个平台保留各自状态。旧计划保留原启用状态和历史，旧调度入口停止接管；迁移后需要用户检查配置，提供尚未执行时的受控回滚。

dot 素材通过确切通道、身份和 externalItemId 匹配，不用 Work 或模板代替 dot 内容。已导入文本可进入受额度约束的 DeepSeek 评分：规则检查与模型分开标注，最多两次改写并保留原文、评分依据和最终版本。所有独立歌曲共用该计划每天的文本总额度。改写后的封面要求刷新，不能把旧封面当作匹配新版本。

创作中心保留手动流程；手动模板、发布中心不再承载调度设置。API、账号、默认材料集中在配置中心。计划表单、身份选择、确认框、执行历史、失败阶段重试和旧历史查看使用蓝白界面。没有音频时播放保持不可用。

## 接入能力与剩余工作

| 能力 | 当前交付状态 | 真实接入剩余条件 |
| --- | --- | --- |
| 计划、状态机、持久化、迁移、重试、停止 | 已实现并离线验证 | 原生窗口验收后才能讨论正式升级 |
| dot 入库与归属验证 | 复用可信本地入库；计划等待正确素材 | 计划到 dot 的远程触发桥未实现；没有更改既有 dot 自动化 |
| 模型评分与有限改写 | 已接既有文本适配器；离线响应测试通过 | 用户已有凭据和额度仍由现有 Main 代理检查；本轮没有真实 HTTP 评分 |
| 封面 | 已有工作室、导入与版本机制；计划复用可信本地封面 | 自动远程出图未接通；改写后重新准备封面；没有免费 Codex 图像 API 承诺 |
| Suno 官方音乐生成 | 不可用，明确提示 | 官方生成 API 未核实；可保留官方生成后导入路径 |
| 谱乐 AI | 待配置网址，不推测站点 | 用户提供确切地址与授权接口 |
| YourMusic / Suno 系列 | 明确为第三方；已保存模型不当作实时可用模型 | 实时可用模型目录、价格上界及真实执行器未接通 |
| 计划内手动音频导入 | 明确不可用 | 计划 Item 与已有手动音频导入流程的绑定尚未实现 |
| 账号专辑 | 支持每账号独立专辑意图及持久化绑定协议 | 没有真实目录、创建/追加执行器；不能据此声称创建成功 |
| 网易云、汽水、QQ、酷狗发布 | 材料与状态模型；真实执行禁用 | 获批发布接口、账号身份、专辑能力和回执核对 |
| 抖音发布 | 按视频发行区分 | 视频素材、开放权限和独立发布适配器 |
| 原生桌面验收 | 本轮未执行 | 用户允许启动后单独验证，不用无头截图代替 |

## 本轮验证

所有测试使用新建隔离目录，外部网络执行器关闭或由离线契约夹具替代。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 计划状态机 | 26/26 | `output/plan-center-offline-test.log` |
| Studio 集成及备份恢复保护 | 8/8 | `output/unified-plan-integration-final.log` |
| 既有生产流程、评分与共享额度 | 43/43 | `output/inbox-shared-budget-final-20261019.log` |
| 模型评分响应与证据契约 | 12/12 | `output/inbox-text-evaluation-20261019.log` |
| 平台/模型/专辑能力目录 | 2/2 | `output/plan-catalog-green.log` |
| 配置分类界面 | 1/1 | `output/unified-plan-configuration-ui.log` |
| 项目冒烟测试 | 3/3 | `output/unified-plan-smoke.log` |
| TypeScript | 通过 | `output/unified-plan-typecheck.log` |
| Electron Main/preload/Core/React 构建 | 通过；现有大分块警告 | `output/unified-plan-desktop-build.log` |
| 无头界面主流程 | 7 项通过 | `output/plan-center-headless-latest.json` |

无头验收使用真实构建的 React、真实隔离 SQLite Core 和明确标注的合成测试账号。验证计划保存、并发编辑阻止陈旧确认、取消、两首独立歌曲、禁止重复点击、停止后计划仍启用、第三方模型不可用声明和手动模板没有时间输入。截图包括计划表单、执行确认、执行进度和通道能力，不是原生客户端窗口截图。

独立复核先发现评分重试所有权、确认竞态、身份选择和历史/重试入口问题，修复后重跑 26+6+2 项未发现新增 P1/P2。随后补充两项真实备份恢复测试，覆盖旧快照不得抹除新执行证据及恢复后暂停/未知状态。

## 启动与交付

交付目录由 `node scripts/package-tme-candidate.mjs --plan-center` 生成，实际路径和提交号见同轮 `output/unified-plan-delivery.json` 及便携包内 `candidate-manifest.json`。保留整个目录。`RainfallStudioCandidate.exe` 为 Electron Windows 便携客户端，默认使用包内独立的空 `candidate-data`；没有安装器、自动启动任务或账号凭据。

当前约束只允许后台工作，因此本轮没有运行 EXE。用户允许打开后，可从该目录启动；不要把空预览数据库替换正式作品库，也不要自动更新正式启动指针。开发构建命令为 `npm run typecheck` 和 `npm run desktop:build`；`npm run desktop:dev` 会打开可见窗口，需遵守当前窗口权限。

真实生成、扣费、协议勾选、上传、正式发布、专辑创建和真实平台统计都没有在本轮发生。
