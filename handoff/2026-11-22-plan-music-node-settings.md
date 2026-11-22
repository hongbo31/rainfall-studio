# 计划中心的音乐节点配置

2026-11-22

新建或编辑计划时，在「工作流程」画布中点击「谱乐 AI」或「苏诺之音」卡片即可配置该节点。节点自动显示上方选择的账号所关联的艺人资料，包括提示词引擎、风格、词曲作者、签约模式、创作类型、封面分辨率、歌手、性别和音色。资料随所选艺人更新，修改资料仍通过账号管理。

音乐服务账号、图像「提供商 / 渠道」和「图像模型」由用户选择。连接「AI作词」或具体文本模型节点后，在「歌名」「B 版歌名（可选）」「音乐风格」「歌词」里指定上游字段。每轮执行读取当轮作词结果。纯音乐流程无需选择歌词。配置可作为草稿保存，执行前检查选项和账号，在歌曲生成前核对所选图像渠道的 Key。

移除了画布上方独立的「封面配置」。谱乐 AI 和苏诺之音使用所在节点选定的图像渠道和型号，沿用歌曲制作的封面创意规则，按保留的每版歌名、歌手和歌词意象生成封面。「创作中心」节点内保留原有的封面开关和配置选择，以支持该路径的已有用法。仅从下载目录发布的计划没有封面设置。

已保存的旧谱乐配置 `workflow.pule` 可继续读取和执行。打开旧计划编辑时沿用原账号、字段映射和明确保存过的图像配置。有全局默认图像配置的旧计划改用新节点设置时需要选定节点的渠道和型号。

## 涉及文件

- `src/renderer/components/PlanWorkflowForm.tsx` 将封面选择移进节点，展示继承的艺人资料，并保存独立的账号、型号和字段映射。`src/renderer/pages/PlanCenter.tsx` 与 `src/renderer/plan-execution-labels.ts` 引导配置和核对失败回执。`src/renderer/pages/PlatformManagement.tsx` 沿用苏诺之音已有卡片。
- `src/shared/plan-workflow-fields.ts`、`src/shared/plan-center.ts` 和 `src/shared/platform-directory.ts` 登记两套音乐自动化共用的节点参数，并加入可执行的「苏诺之音」节点。后续接入音乐平台时在同一处登记提供商和执行入口。
- `src/core/plan-workflow.ts`、`src/core/plan-center/index.ts`、`src/core/generation-config.ts` 和 `src/shared/generation-config.ts` 验证参数并保存执行时的型号和配置版本。选定的型号仅用于该计划。
- `src/shared/plan-pule.ts`、`src/core/plan-pule.ts`、`src/main/plan-pule.ts`、`src/main/suno-cn-browser-page.ts` 和 `src/main/bootstrap.ts` 通过所选苏诺之音账号执行一次歌曲制作。原始 WAV 按此次制作分开暂存并记录哈希，导入时复用这一回执。付费结果未确认时暂停并保留已有回执信息，等待人工核对。
- `src/shared/cover-handoff.ts` 和 `src/main/pule-browser.ts` 共用既有封面创意规则。`src/core/cover-handoff.ts`、`src/core/cover-inbox.ts` 与 `src/main/plan-cover-image.ts` 使用节点选定的型号生图并核对 A、B 版归属。

## 验证与回退

- 通过 `Start-Rainfall-Browser.bat -BuildOnly` 的隔离构建及 TypeScript 检查。4 项浏览器无头测试覆盖节点选择、字段的保存与回显、旧计划配置带入、创作和发布路径。
- 69 项计划、归档和图像接口测试与 21 项封面恢复测试通过。以配置默认 Seedream 5.5、节点选择 Seedream 5.0 Pro 为例，核对了两次模拟请求各自的歌名和歌手、实际请求型号，以及两版封面分别入库。79 项谱乐 AI 与苏诺之音网站夹具测试通过。
- Windows 端验证了共用的 Main、预加载、Core 和界面构建。Electron 的 Node 模式通过 9 项路由回归，另验证了苏诺节点的参数校验、原始 WAV 导入及图像型号传递。本轮使用隔离测试库、模拟凭据和离线网站夹具。真实服务调用及 Windows 原生窗口待验收。
- 浏览器预览沿用原启动入口。如需回退，恢复本轮改动并通过原入口重建。回退到旧程序前保留含 `workflow.browserMusic` 的计划和执行回执备份，旧版仅识别此前的谱乐节点配置。正式作品库和桌面快捷方式未切换。
