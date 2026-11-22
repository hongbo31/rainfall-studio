# 封面 API 配置与平台管理出图

配置中心的封面页收敛为「提供商 / 渠道」和「API Key」两个字段。OpenAI、智谱 AI、豆包 / 火山方舟分别保存密钥。切换渠道时清空当前输入并读取所选渠道的保存状态。密钥沿用客户端的加密存储及受保护的凭据接口。

平台管理的图像模型卡片从「账号信息」打开出图面板。选择图像模型、发布平台、艺人，再填写创意描述。艺人按所选平台已关联的发布账号筛选。切换平台后重新选艺人，界面显示艺人资料中的方形封面分辨率。生成成功后可预览并下载 JPEG。

配置保存会复用现有的同渠道配置。历史上保存了多条同渠道配置时，优先使用已保存密钥的工作流默认配置，其次使用其他已保存密钥的配置。首次保存密钥时可以初始化空缺的工作流默认项。现有默认项可在出图面板通过「设为工作流默认」显式切换。单次出图使用本次所选模型，保留既有计划的配置快照。

## 涉及文件

- `src/renderer/components/ApiSettings.tsx`、`CredentialInput.tsx`、`ImageCredentialSettings.tsx`、`src/renderer/image-credential.ts` 和 `src/renderer/desktop.css` 负责封面密钥配置、读取和输入状态。
- `src/renderer/pages/PlatformManagement.tsx`、`src/renderer/components/PlatformCardHeader.tsx`、`ImageGenerationDialog.tsx` 和 `src/renderer/platform-management.css` 提供图像模型卡片的出图入口、结果预览与下载。
- `src/shared/platform-image.ts`、`src/shared/schemas.ts`、`src/core/platform-image.ts`、`src/core/index.ts` 和 `src/core/studio.ts` 负责请求校验、配置复用、工作流默认项和艺人与平台归属校验。
- `src/main/bootstrap.ts`、`src/main/platform-image.ts`、`src/main/api-credentials.ts` 和 `src/main/plan-cover-image.ts` 复用原封面服务、密钥和图片处理逻辑。发出生成请求前复核所选艺人与分辨率，输出尺寸按艺人配置处理。
- `tests/platform-image.test.mjs` 和 `tests/platform-management-ui.test.mjs` 覆盖渠道配置、艺人筛选、模型选择、实际输出像素和浏览器下载。

## 验证与回退

- 在源码同级构建目录的隔离检出中运行 TypeScript 检查和 17 项定向测试，全部通过。无头浏览器覆盖密钥保存、切换平台、选择艺人、预览与下载。接口替身覆盖模型与安全校验，JPEG 解码验证为艺人设定的尺寸。
- 完整集成测试在改动前后均为 237 项中 233 项通过。两侧均出现同样的 4 项失败，分别为旧素材目录未提供、两项 TME 条款测试的版本断言、旧日程迁移的执行次数断言。
- Windows 主进程、预加载、核心服务和前端通过 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 构建。浏览器预览和 Windows 客户端共用这套出图与凭据逻辑。真实提供商请求和 Windows 原生窗口待验收。
- 本轮代码沿用原有 API 配置、凭据和作品数据格式。浏览器沿用现有启动入口，桌面交付沿用已验收版本。回退时撤销本记录列出的改动，保留现有数据目录和凭据文件。
