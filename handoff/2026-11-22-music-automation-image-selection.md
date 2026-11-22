# 谱乐 AI 与苏诺之音的歌曲封面模型选择

2026-11-22

「平台管理 → 歌曲生成 → 执行 → 歌曲制作」的封面图片区可以选择「提供商 / 渠道」和「图像模型」。选项来自现有 OpenAI、智谱和豆包 / 火山方舟图像模型目录。打开时优先带入工作流默认图像配置，切换渠道时读取该渠道的配置和 Key 状态。缺少该渠道的 Key 时提示配置位置，开始制作前完成检查。选定的配置用于本次任务。

谱乐 AI 和苏诺之音共享原封面规则。A、B 两版按各自歌名和歌手，结合曲风、封面风格、情绪和简短歌词意象生成创意描述，再使用本次选定的接口和型号出图。PNG 按艺人的封面分辨率处理，与对应 WAV 同名归档。开始制作处显示积分和封面计费信息。

苏诺之音的新记录保存所选渠道、型号和两版封面描述。补生成时重新核对原渠道的配置并沿用原型号，仅处理缺图的版本。已有 WAV、TXT 和已生成的封面可继续使用。此前没有模型选择记录的任务仍按当前默认图像配置补图。

## 涉及文件

- `src/renderer/components/PuleBrowserGeneration.tsx` 和 `src/renderer/platform-management.css` 增加两套歌曲制作共用的封面选择、状态及费用提示。执行记录显示选定的渠道和型号。
- `src/shared/platform-image.ts`、`src/shared/pule-browser.ts`、`src/core/platform-image.ts`、`src/core/index.ts` 校验渠道、图像配置版本和所选型号。旧请求可沿用默认图像配置。
- `src/main/bootstrap.ts` 和 `src/main/pule-browser.ts` 将选择传入现有生图适配器，并保存苏诺之音补图所需的型号和描述。

## 验证与回退

- 同级隔离目录的 `Start-Rainfall-Browser.bat -BuildOnly` 和 TypeScript 检查通过。浏览器无头测试验证了两套制作窗口的默认选项、渠道切换、缺少 Key 时的提示和提交的具体型号。
- Windows 共用的 Main、预加载、Core 和界面构建通过。Electron 的 Node 模式复跑了谱乐两版指定型号、Core 配置范围和苏诺补图三项验收。凭据及生成服务使用夹具，浏览器页面使用离线替身。
- 谱乐 62 项、苏诺之音 17 项、浏览器界面 4 项、计划与接口等 62 项、封面恢复 21 项通过。主要回归位于 `tests/pule-browser.test.mjs`、`tests/suno-cn-browser.test.mjs` 和 `tests/platform-management-ui.test.mjs`。真实出图、音乐服务和 Windows 原生窗口待验收，正式库与桌面入口未作切换。
- 如需回退，恢复本轮所列文件后通过原浏览器入口重建。新增的执行记录字段为可选，现有下载归档与 API Key 沿用原存储格式。
