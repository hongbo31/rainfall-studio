# 计划画布的节点配置

2026-11-20

## 使用

1. 打开「计划中心 → 新建计划」或编辑已有计划。先选择发布平台和该平台的账号，再选择账号下的艺人。直接创作的计划可将发布平台留空。发布步骤由画布连线决定。
2. 选中艺人后，表单带出提示词引擎、创作类型、风格、封面分辨率、词曲作者、签约模式、歌手数量、A/B 版歌手、性别和音色。同平台的发布节点沿用计划顶部的发布账号。
3. 将流程节点拖入画布并连接。节点按类型着色，点击节点即可在画布下方配置。新计划的 AI 作词节点继承所选艺人和提示词引擎，选择文本 API 和改写次数。原有的灵感计划保留灵感配置。
4. 谱乐 AI 节点选择要实际制作的谱乐账号，再从相连上游的输出中逐项指定歌名、可选 B 版歌名、音乐风格和歌词。纯音乐只产生歌名一、歌名二和风格描述。选择纯音乐艺人后，删除无效的歌词绑定并由谱乐网页启用纯音乐。
5. 番茄音乐节点可设置每批上传上限和签约方式，执行确认时会显示已保存的设置。[番茄分批和签约设置](./2026-11-21-plan-fanqie-batch-settings.md)

## 执行与兼容性

- 文本模型仍使用配置中心的文本 API。新配置的谱乐节点通过所选账号的专属网页登录会话制作歌曲。B 版歌名指定后，按本次已核对的第二首歌曲 ID 在谱乐修改歌名。仍由计划中心负责音频入库、封面、归档和发布阶段。
- 账号或必填映射缺失时可保存手动草稿，实际执行前提示补全。字段值超出网站控制支持的范围时，在提交前停止。定时执行沿用现有的计划授权。
- 音乐提交和下载分开记录。已有歌曲 ID 时，重试只核对和下载该账号下的原歌曲。提交结果未知时，可打开该账号管理核对官网历史。旧图的 API 生成与回执核对继续走原有路径。
- 工作流、映射和账号 ID 保存到正常的计划与执行快照。原有字段可读，新增配置为可选，数据库版本号沿用原值。

## 涉及文件

- 账号与艺人筛选、配置面板和配色在 `src/renderer/components/PlanWorkflowForm.tsx`、`src/renderer/components/PlanWorkflowCanvas.tsx`、`src/renderer/pages/PlanCenter.tsx` 和 `src/renderer/plan-center.css`。
- 节点字段、配置快照及结果校验在 `src/shared/plan-workflow-fields.ts`、`src/shared/plan-center.ts`、`src/shared/generation-config.ts`、`src/shared/plan-pule.ts`、`src/shared/pule-browser.ts`、`src/core/plan-workflow.ts`、`src/core/plan-center/index.ts`、`src/core/generation-config.ts` 和 `src/core/plan-pule.ts`。
- 谱乐专属账号执行、生成与按回执下载在 `src/main/bootstrap.ts`、`src/main/plan-pule.ts`、`src/main/pule-browser.ts` 和 `src/main/pule-browser-page.ts`。
- 回归用例在 `tests/plan-workflow-refactor.test.mjs`、`tests/plan-workflow-ui.test.mjs`、`tests/pule-browser.test.mjs` 和 `tests/fixtures/pule-browser.html`。

## 验证与交付

- 使用同级构建目录通过 `Start-Rainfall-Browser.bat -BuildOnly` 构建共享渲染层、Core、Windows Main 和预加载层，并通过 TypeScript 检查。
- 无头 Chromium 使用实际浏览器构建和隔离 SQLite，核对了番茄账号范围、引擎和 1440 × 1440 封面配置、点击节点编辑、手动对调歌名、保存并重新打开已有配置，以及切换到纯音乐后三个字段的保存。
- 执行器夹具覆盖有歌词、纯音乐、账号与字段校验、已知歌单的下载重试和回执丢失。谱乐网页夹具核对纯音乐开关、B 版改名、仅按原 ID 下载及独立账号会话。计划中心旧数据和番茄队列使用原离线测试脚本验证。
- 浏览器和 Windows 客户端共用渲染层与执行器。本轮验收在后台隔离环境中完成。Windows 原生窗口、真实谱乐登录与扣费、正式发布和签约待验收。

用原来的 `Start-Rainfall-Browser.bat` 启动。若需回退，先暂停使用新节点配置的定时计划，备份作品库与回执，再用升级前的备份做隔离演练。桌面入口按项目桌面交付策略切换。
