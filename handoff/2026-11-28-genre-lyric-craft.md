# AI 作词按曲风升级（2026-11-28）

用户授权 xb 安排专业分析与歌词能力升级，不要求用户提供专业作词指标。作词编辑研究与代码入口审计分别进行；参考 Pat Pattison、Berklee 与 BMI 的一手教学资料，方法和链接见[设计](../docs/superpowers/specs/2026-11-28-genre-lyric-craft-design.md)，文件归属见[计划](../docs/superpowers/plans/2026-11-28-genre-lyric-craft.md)。

已完成源码实现、作词编辑复审、独立技术审查及隔离回归。共享服务原有生成→评分→限次改写流程保留；本轮针对指导过于概括、评分缺少风格语境的问题升级。尚未用真实模型和成曲试听验收艺术质量。

## 改动与影响

- `src/core/lyric-craft.ts`：新增版本化规则 v1。生成强调人物语体、处境、具体表达、段落作用和记忆点；曲风建议是可择用方向，允许混合风格、非叙事、无副歌及有意循环。语种独立于曲风；没有旋律时不声称已验证协音或演唱效果。
- `src/core/lyric-writing.ts`：新建人声 AI 作词任务在估价前记录版本，生成、评分、改写各自采用对应指导；评语定位原句→问题→影响→修订方向，改写保留有效内容、优先解决关键问题。无标记旧任务不回填，沿用原稿的两类 retrySource 分支继承来源版本（包括缺省旧版）。内部版本不出现在 UI 返回值。
- 当前请求按实际消息估价；未来评分、改写分别加上相应指导的 JSON UTF-8 字节开销，旧版预算基值保留。没有增加调用阶段或改写上限，但提示变长会增加输入 token，不能保证费用不变。
- `tests/lyric-craft.test.mjs`：新增 16 项回归，覆盖三个阶段、新旧任务/重载/幂等、两类原稿重试、纯音乐及灵感排除、私有版本、各阶段预算、停止与不足预算。
- `tests/lyric-writing.test.mjs`：仅把一个“结算后不足预算不得自动重试”的固定 100 micros 样例改为按首调用实际预留设置；结算后仍只剩 1 micro，并断言不重试。未调整生产预算。
- 设计/计划、`docs/project/board.md` 及 `handoff/PROJECT-HANDOFF.md` 索引同步更新。既有歌名改动、已存歌词、JSON 字段及五项评分结构保留；独立 Pule 修复未改动。

## 验证证据

测试均在源码同级隔离目录执行：`E:/WYX/wyx/rainfall-studio-build/lyric-craft-5d7fab74`。使用内存 SQLite、模拟供应商响应，无真实 API 请求。四个修改后的源码/测试文件与最终测试快照的 SHA-256 一致。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `node --test tests/lyric-craft.test.mjs` | exit 0，16/16 通过 | `lyric-craft.log` |
| `node --test tests/lyric-writing.test.mjs` | exit 1，30/33 通过；剩余 3 项均在保留既有标题规则的本轮前基线复现 | `lyric-writing.log`、`baseline-lyric-writing.log` |
| `node --test tests.mjs` | exit 0，3/3 通过；这是 package.json 的 test 脚本，仅验证三个 web/domain 用例，不是全仓测试 | `npm-script-test.log` |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 1，12 条诊断均在本轮未修改文件或缺失依赖；不能称全仓类型检查通过 | `typecheck.log` |
| `git diff --check` | 通过；有 LF/CRLF 提示，无空白错误 | 命令输出 |

原作词套件的 3 项基线失败：音乐任务提交内容的标点清洗预期、灵感工作流段落标签的清洗预期、纯音乐旧标题提示 `/声音.*画面/` 断言。初次运行另有固定 100 micros 测试预算不足，按上述测试样例调整后通过。类型检查涉及番茄 directory/native-upload、苏诺 Node 类型、remote-assist/qrcode 缺依赖及 plan-execution-labels 重复属性；本轮 Core 文件未报诊断。

原作词套件运行前，PowerShell 7 在当前测试进程设置 `NODE_PATH` 为相邻既有隔离目录 `../lyric-response-recovery-7a9c4819/source/node_modules`，复用已有 reflect-metadata/x509 依赖；未安装或修改依赖。`npm` 不在该执行环境 PATH，因此直接执行 package script 对应的 Node 命令。

作词编辑只读复审确认曲风、语种、无副歌/循环和文本可唱性边界合理。独立代码审查确认版本继承、旧任务隔离、私有字段与预算增量正确。mock 结果仅证明流程和兼容性，不代表真实歌词已经达到精品水平。

## 双端、未验证事项及后续

AI 作词页面与计划 AI 作词节点均使用同一 Core，浏览器和 Windows 客户端共用本次规则。完成共享 Core 的无界面验证；没有启动浏览器或 Windows 原生窗口，没有真实模型调用、音频试听或原生 UI 验收。当前 `verified-desktop.json` 缺失，未接触正式库或切换桌面入口；未提交、推送、打包或更新已安装 EXE。

使用更新后代码新建的人声作词任务才启用 v1。沿用旧稿的重试保留旧规则，不会悄悄重新生成旧作品。后续按设计中的同题材/同模型样本标准比较各曲风新旧歌词及改写结果，再结合真实成曲试听；既有 3 项测试失败和 12 条类型诊断另行处理。

## 回退

停止为新任务分配 v1，但保留 v1 函数供已经持久化的任务恢复；没有 v1 在途任务时可定向撤销本轮接入。不要整文件恢复 `lyric-writing.ts` 或清理作品，以免撤掉并行歌名修改或破坏旧任务。没有新增数据库表、迁移或依赖。
