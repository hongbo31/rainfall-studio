# 计划中心重构交接

## 改动原因与操作

原计划卡片在计划较多时不便查找和对比。旧作词工作流每次只能执行一轮，下载归档也没有按歌手区分版本。

- 计划中心以表格显示名称、创建时间、执行结果、操作。可以按名称搜索。每行提供「立刻执行」「编辑」「详情」，详情中可以查看执行历史、停止本次执行和确认删除。删除只移除计划及未来调度，保留已有作品、音频、归档和执行历史。
- 「新建计划」打开名称、艺人信息、歌曲生成次数和工作流程表单。将「AI作词」与「创作中心」拖入画布，再从作词输出端拖到创作输入端建立箭头。也可以按顺序点击或用键盘操作节点和端口。保存要求连接完整，次数范围为 1–20。
- 新计划保存为手动草稿。模型可在保存后配置，立刻执行前会核对模型、费用授权和下载根目录。高级设置可指定灵感、模型、封面和定时执行。旧素材计划入口在「高级选项」，原定时、历史和发布材料流程继续使用。已有无图作词工作流打开时显示原有两步，保存编辑后采用新图执行规则。

## 生成与归档

- 每轮取 AI 作词的通过稿，交给创作中心的自定义歌曲执行链路。首选歌名、歌词和音乐风格用于原请求。艺人、歌曲类型和歌手性别按执行时冻结的艺人资料带入。纯音乐只传歌名与风格，歌词为空，音乐请求不带声线参数。作词稿超过音乐接口的歌词长度上限时停在作词阶段，允许重试。
- 生成次数表示顺序运行工作流的次数。音频原件校验、入库和归档都成功后才记为完成一轮。下载、归档或等待原任务回执时，下一轮保持等待。停止本次执行会结束后续阶段，已发出的生成请求及其回执继续保留。结果未知时，执行详情的「核对生成回执」只查询原任务。
- 归档根目录取「歌曲和发布材料下载位置」。原「目录与收件」中的这项设置现在位于「配置中心 → 下载目录」，继续使用同一目录记录。按现有归档约定，`音乐人账号_歌手名_提示词模板名` 是文件夹名，音频文件保留歌名、版本和校验标识。艺人没有关联模板时，文件夹使用「未关联提示词」。双歌手目录若清理非法字符后重名，B 目录追加 `_B`。
- 单歌手每轮从可用原件中随机保留一版，重试沿用该轮的选择倾向。双歌手每轮保留原回执中的 A、B，分别写入对应歌手目录；歌词和已有发布材料同时归档。谱乐 AI 的一次音乐请求仅支持一项声线参数，使用第一歌手的设置。A/B 分目录对应演唱者归档，实际演唱声线仍由服务生成。供应商历史缺少可信 A/B 顺序时，双歌手结果保留待核对。
- 新图工作流自身不触发发布。发布任务仍按其独立授权和合同流程执行。受信目录请求沿用已保存的授权，未授权的新图草稿不会被文件触发。

## 涉及文件

| 范围 | 文件与职责 |
| --- | --- |
| 浏览器与 Windows 共用界面 | `src/renderer/pages/PlanCenter.tsx`、`src/renderer/components/PlanWorkflowForm.tsx`、`src/renderer/components/PlanWorkflowCanvas.tsx`、`src/renderer/plan-center.css` 实现表格、详情、编辑和流程图。`src/renderer/main.tsx`、`src/renderer/pages/ConfigurationCenter.tsx` 接通下载目录的定位。 |
| 计划与执行 | `src/shared/plan-center.ts`、`src/shared/schemas.ts` 定义图、授权和计划接口。`src/core/plan-center/index.ts`、`src/core/plan-center-integration.ts` 管理计划、执行快照、串行计数和归档结果。 |
| 作词与音乐 | `src/core/plan-workflow.ts`、`src/core/lyric-writing.ts`、`src/core/workflow/provider-text.ts` 接通艺人参数、作词稿和停止结果。`src/core/plan-pule.ts`、`src/main/plan-pule.ts`、`src/shared/plan-pule.ts`、`src/core/workflow/yourmusic.ts` 处理下载选择、回执与接口边界。 |
| 归档 | `src/core/download-archive.ts`、`src/shared/download-archive.ts` 保存目录与录音版本的关联，复用既有文件防覆盖和校验方式。 |
| 回归 | `tests/plan-workflow-refactor.test.mjs`、`tests/plan-workflow-ui.test.mjs`、`tests/download-archive.test.mjs` 覆盖新工作流。`scripts/test-plan-center-headless.mjs`、`scripts/test-plan-cover-recovery-ui.mjs`、`tests/fixtures/plan-center-ui-host.cjs` 更新旧计划和封面的无头回归。 |

## 验证

在源码同级构建目录的隔离检出中执行，使用临时 SQLite、原件下载夹具和已安装的媒体探测工具。

| 检查 | 结果 |
| --- | --- |
| TypeScript 全库检查，Windows Main、Preload、Core 和渲染器编译 | 通过。Vite 提示部分渲染块超过默认体积告警阈值。 |
| 基础、浏览器桥接、工作流核心、下载归档、AI 作词 | 38 项通过。覆盖增删改查、单歌手随机保留一版、双歌手独立归档、纯音乐、等待原件、多轮顺序、停止和恢复。 |
| 旧计划调度、统一计划、番茄计划和封面恢复 | 69 项通过。分别使用 `scripts/test-plan-center.mjs`、`scripts/test-unified-plan-integration.mjs`、`scripts/test-plan-fanqie.mjs`、`scripts/test-plan-cover-recovery.mjs` 的离线夹具。 |
| 计划中心无头 Chromium 与静态渲染 | 2 项通过。覆盖表头、搜索、拖放、键盘连线、配置定位和下载目录的选择与清除、编辑和确认删除。 |
| 旧素材计划和封面交接的无头回归 | `scripts/test-plan-center-headless.mjs` 和 `scripts/test-plan-cover-recovery-ui.mjs` 通过。使用真实渲染界面与隔离 SQLite 验证原排程、版本试听和封面恢复。 |

## 待验收与回退

- 两端使用同一个渲染器、RPC 校验和生成执行器。浏览器桥接和共享界面已通过无头测试。Windows 端已验证编译，原生窗口、真实 API 生成、实际发布及合同未做验收。本轮仅修改源码和测试，没有打正式包或切换桌面入口。
- 旧目录任务的独立界面回归脚本依赖早期配置页和模型表单。早期布局中的目录绑定已验证，当前下载设置由新版计划中心无头测试覆盖。
- 新图和版本绑定存于现有 SQLite 的 JSON 记录中，未提升数据库版本号。旧计划数据继续读取。若需要回退到不识别新图的旧版，先停用新图的定时，并保留当前库、下载目录和外部回执的备份。使用升级前备份在隔离位置核对旧版，再按桌面交付流程切换。已产出的作品和已提交的任务应保留，避免从旧库重复执行。
