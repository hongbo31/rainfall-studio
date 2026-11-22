# 封面图片 API Key 回显与检查连接

2026-11-22

配置中心的「模型 API → 封面图片」按所选渠道读取和保存 Key。OpenAI、智谱和火山方舟使用各自的图像配置及加密凭据。已有 Key 和刚保存的 Key 都在原输入框回显前两位与后四位，中间逐位显示 `*`。长度不足七位的录入值全部用 `*` 表示。点击「更换 Key」可录入新值，取消后恢复已保存的遮罩。文本服务配置现在位于「歌词与提示词」下。

「检查连接」位于「保存 Key」旁，使用本渠道已保存的 Key。OpenAI 和火山方舟使用各自的模型列表，智谱查询最多一条 `batch` 文件列表记录。检查只发一条只读 GET，丢弃提供商返回的数据，只显示认证结果。认证通过表示 Key 可用于该查询，实际出图权限和额度仍由提供商在出图时检查。 [OpenAI 模型列表](https://developers.openai.com/api/reference/resources/models/methods/list) · [智谱文件列表](https://docs.bigmodel.cn/api-reference/%E6%96%87%E4%BB%B6-api/%E6%96%87%E4%BB%B6%E5%88%97%E8%A1%A8.md) · [火山方舟 Models API](https://console.volcengine.com/ark/region:cn-beijing/docs/models-api)

## 涉及文件

- `src/main/api-credentials.ts` 生成遮罩、按指定图像配置读取凭据，并将认证检查结果映射为安全状态。`src/shared/api-profiles.ts`、`src/shared/contracts.ts` 增加遮罩读取选项和结果类型。
- `src/shared/platform-image.ts` 声明三家只读检查地址，`src/core/workflow/yourmusic.ts` 在现有 HTTPS 传输中限制这些地址的用途、方法和查询参数。
- `src/renderer/image-credential.ts`、`src/renderer/components/ImageCredentialSettings.tsx` 和 `src/renderer/components/CredentialInput.tsx` 显示渠道遮罩及认证反馈。`src/renderer/components/ApiSettings.tsx`、`src/renderer/pages/ConfigurationCenter.tsx` 将文本服务配置归入文本页签。

## 验证与回退

- `Start-Rainfall-Browser.bat -BuildOnly` 在同级构建目录通过，TypeScript 检查通过。无头浏览器用模拟接口验证保存后回显、切换渠道、连接成功与认证失败、清除隔离，以及文本服务模块位置。音乐 Key 的输入和连接检查也通过原有无头回归。
- Windows 的 Main、预加载、Core 与共享界面构建通过。Electron 的 Node 模式复跑三项凭据回归，并用隔离库验证已有加密凭据的遮罩和三家只读请求的范围。相关测试位于 `tests/integration/api-credentials.test.cjs`、`tests/zhipu-cover.test.mjs` 和 `tests/platform-management-ui.test.mjs`，封面任务回归亦已通过。
- 真实 API Key 的在线认证和 Windows 原生窗口待验收。测试使用模拟 Key 与隔离库，生产库和当前桌面交付未被操作。
- 需要回退时，恢复本轮源码并沿用原浏览器入口重建。保存位置、加密格式及配置 ID 沿用原流程，可继续读取现有凭据。
