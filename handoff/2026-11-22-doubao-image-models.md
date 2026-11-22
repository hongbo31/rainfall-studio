# 平台管理接入豆包 Seedream 图像模型

2026-11-22

平台管理的图像卡片沿用文本模型卡片的布局。OpenAI、智谱和豆包 / 火山方舟均有「打开页面」和「账号信息」。卡片显示本机配置名称和可选型号。「账号信息」在右侧显示该平台的配置、默认选择和 Key 保存状态，已存 Key 继续使用现有加密存储。方舟图像配置拥有独立的 Key 保存项，可以使用该账号下已开通所选 Seedream 型号的 Key。

## 接口与使用

| 型号 | API 型号 ID | 方图参考价 |
| --- | --- | --- |
| Doubao Seedream 5.5 | `doubao-seedream-5-5-261028` | ¥0.13/张 |
| Doubao Seedream 5.0 Pro | `doubao-seedream-5-0-pro-260628` | ¥0.30/张 |

两款均支持文生图。封面任务向北京区图片生成接口请求单张 1536 × 1536 JPEG。收到后沿用封面尺寸处理和回执记录。上表为这类文生图请求的公开参考价。 [方舟图片生成教程](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-tutorial) · [方舟图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api) · [方舟定价](https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing#图片生成模型)

在「平台管理 → 图像模型 → 豆包 / 火山方舟 → 账号信息」新增本机配置，选定型号并保存 Key。选为默认后，可在封面工作室按按钮上的型号和参考价发起出图。计划编辑器也可选择此配置。重试沿用原任务的型号与配置版本，手动生成和封面重试校验所确认的付费型号。已有的智谱重试入口保持兼容。

## 改动位置

- `src/shared/api-profiles.ts` 和 `src/shared/platform-directory.ts` 登记型号、价格、凭据范围和官网入口。
- `src/renderer/pages/PlatformManagement.tsx`、`src/renderer/platform-management.css`、`src/renderer/components/ApiSettings.tsx` 加入统一卡片和按平台筛选的账号配置窗口。
- `src/renderer/components/PlanWorkflowForm.tsx` 读取共享型号目录，`src/renderer/components/CoverInbox.tsx` 与 `src/renderer/pages/CoverStudio.tsx` 显示手动出图和重试的型号或费用。
- `src/main/api-credentials.ts` 与 `src/core/workflow/yourmusic.ts` 发送并校验独立的方舟图像请求。`src/core/cover-handoff.ts`、`src/core/cover-inbox.ts`、`src/core/studio.ts`、`src/shared/cover-handoff.ts` 与 `src/shared/schemas.ts` 接入现有封面任务、回执和重试。

## 验证与回退

- 在同级的浏览器构建目录通过 `Start-Rainfall-Browser.bat -BuildOnly`、TypeScript 检查及 82 项回归。无头 Chromium 验证三家图像卡片的官网入口、按平台查看 Key 状态、默认配置切换，以及 5.0 Pro 封面按钮传递对应型号和费用。原浏览器入口继续从源码构建新版。
- Windows 验证覆盖 Main、预加载、Core 和共享界面的构建。Electron 的 Node 模式通过配置与任务路由回归，并复跑两个 Seedream 型号的用例。隔离库中使用模拟响应验证请求、收图与来源回执。测试包括 `tests/platform-management-ui.test.mjs`、`tests/plan-cover-recovery.test.cjs` 和 `tests/zhipu-cover.test.mjs`。
- 真实 Key 的权限、实际账单、真实生成结果和原生窗口待验收。验证使用隔离库以及模拟响应。生产库、已保存 Key、默认配置和桌面入口均未改动。
- 若回退至旧版，先备份当前库和配置，确认需要保留的作品与资源，再用兼容旧版的配置和对应回退包。旧版无法使用新建的 `doubao_image` 配置。尚未在本地保存方舟图像配置时，可直接恢复本轮源码。
