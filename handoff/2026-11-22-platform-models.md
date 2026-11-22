# 平台管理的文本和图像模型

2026-11-22

平台管理原先只列文本服务商，封面模型要去配置中心查看，且每个图像服务商的生成请求固定发给一个型号。两类模型现在分别在平台管理打开右侧配置，复用配置中心已有的默认选择、API Key 和保存操作。

## 型号与调用

- 文本配置可选择 DeepSeek V4.1 Flash-1017、V4 Pro-0813 和豆包 Seed 2.1 Pro、Lite。选择预设会填入接口型号和公开参考计价，推理接入点仍可手动填写。DeepSeek 使用高峰未缓存价，豆包使用常规文本推理价。现用 `deepseek-flash` 已由官方提供 V4.1 Flash-1017。 [DeepSeek 型号与定价](https://api-docs.deepseek.com/quick_start/pricing/) · [方舟型号](https://console.volcengine.com/ark/region:cn-beijing/docs/model-list) · [方舟定价](https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing)
- 图像配置可选择 OpenAI GPT Image 2.6 Flare、Sunburst，或智谱 CogView-3-Flash、GLM-Image。新任务按所保存的型号调用。GLM-Image 的手动生成与重试显示 ¥0.10/次并确认对应型号。生成请求使用该型号的提示词长度和图片尺寸规则，再按作品的封面设置处理尺寸。 [OpenAI 图像接口](https://developers.openai.com/api/reference/resources/images/methods/generate) · [智谱 GLM-Image](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image)

## 涉及文件

- `src/renderer/pages/PlatformManagement.tsx`、`src/renderer/components/ApiSettings.tsx`、`src/renderer/platform-management.css` 实现两类配置入口、预设和右侧窗口。
- `src/shared/api-profiles.ts`、`src/core/generation-config.ts`、`src/core/cover-handoff.ts`、`src/core/cover-inbox.ts`、`src/main/api-credentials.ts` 校验配置、任务快照与发送的图像型号一致。输出沿用封面接收与来源记录流程。
- `src/shared/cover-handoff.ts`、`src/shared/schemas.ts`、`src/core/studio.ts`、`src/renderer/components/CoverInbox.tsx`、`src/renderer/pages/CoverStudio.tsx` 传递手动生成及重试的型号确认，并显示费用。

## 验证与回退

- 在同级隔离构建目录通过 `Start-Rainfall-Browser.bat -BuildOnly`、TypeScript 检查及 113 项测试。主要回归位于 `tests/platform-management-ui.test.mjs`、`tests/lyric-writing.test.mjs`、`tests/zhipu-cover.test.mjs` 和 `tests/plan-cover-recovery.test.cjs`。平台管理用例也将谱乐下载超时断言对齐当前提示。
- 浏览器在隔离数据下验证模型配置、默认选择和测试请求使用所选设置。Windows 通过 Main、Core、预加载和共享渲染层构建，并用 Electron 的 Node 模式验证配置快照与任务路由。封面回归使用模拟响应，核对型号、下载和来源记录。
- 生产库仅用于只读核对当前型号。封面现用配置为 `cogview-3-flash`。升级后的型号由用户在配置里选择并保存。真实计费请求及 Windows 原生窗口待验收。
- 回退前，在新版中把已经保存的 `glm-image` 和 `gpt-image-2.6-sunburst` 配置改回原来使用的型号，再恢复本轮对应代码。旧版仅能读取其支持的图像型号。
